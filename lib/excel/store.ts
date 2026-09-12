import "server-only";

import ExcelJS from "exceljs";
import { createHash, randomUUID, randomBytes, randomInt } from "crypto";
import { config } from "@/lib/config";
import { round2 } from "@/lib/format";
import { valueReport } from "@/lib/value";
import { roleFor, isAllowed, allowlistEntry, ALLOWLIST } from "@/lib/allowlist";
import { adminDb } from "@/lib/firebase/admin";
import type {
  MiningStatus,
  MineOutcome,
  BuyPackOutcome,
  MiningTier,
} from "@/lib/types";

/**
 * The pure-Excel live store.
 *
 * The .xlsx on disk is the single source of truth. On boot it is loaded into an
 * in-memory model (fast reads). Every mutation is serialized through a
 * single-writer queue: validate against current state -> write a temp file ->
 * atomic rename over the master -> only then commit the change in memory. A
 * crash therefore leaves either the old or the new file intact, never a
 * half-written one. Rolling backups are kept for recovery.
 *
 * Because mutate() runs one at a time, concurrency hazards (double-spend,
 * negative balances, two buyers taking the same offer) are resolved by
 * re-validating inside the mutation — first commit wins, the rest fail cleanly.
 */

// ── Domain types ────────────────────────────────────────────────────────────
export type Member = {
  email: string;
  name: string;
  balance: number; // CC wallet (may go negative down to the credit floor)
  dcBalance: number; // Dark Capsule Coin wallet — mined/bought; never negative
  verified: boolean;
  role: string;
  lastMinedAt: string | null; // ISO
  createdAt: string; // ISO
  // Mining v2 daily state (reset each UTC day)
  mineDay: string; // UTC yyyy-mm-dd of the current allowance window ("" = needs reset)
  freeMinesUsed: number; // free mines used today
  paidTier: number; // pay-to-mine packs unlocked today (0..ladder.length)
  paidRemaining: number; // paid attempts left from the last unlocked pack
  // Credit-floor grace / ban state (config.grace). When CC crosses below the soft
  // floor, graceUntil is set to the ISO deadline; miss it and `banned` latches on.
  graceUntil: string | null;
  banned: boolean;
  // First-login story mode: ISO time the member finished the DC intro (null = pending).
  onboardedAt: string | null;
};

export type OfferType = "SELL" | "BUY";
export type OfferStatus = "OPEN" | "COMPLETED" | "CANCELLED";

export type Offer = {
  id: string;
  type: OfferType;
  creatorEmail: string;
  creatorName: string;
  itemName: string;
  category: string;
  description: string;
  priceCC: number;
  status: OfferStatus;
  counterpartyEmail: string | null;
  counterpartyName: string | null;
  escrowAmount: number; // CC locked from a BUY creator while OPEN
  createdAt: string;
  closedAt: string | null;
};

export type TransferStatus =
  | "PENDING"
  | "APPROVED"
  | "DECLINED"
  | "CANCELLED"
  | "EXPIRED";

/**
 * A peer-to-peer CC transfer that needs the payer's consent before it settles.
 * REQUEST (payee-initiated) sits PENDING until the payer approves; SEND
 * (payer-initiated) settles immediately since the payer is the initiator.
 */
export type TransferRequest = {
  id: string;
  fromEmail: string; // payer — CC leaves here
  fromName: string;
  toEmail: string; // payee — CC arrives here
  toName: string;
  amountCC: number;
  item: string; // what the CC is for
  note: string; // optional memo
  initiatedBy: "PAYER" | "PAYEE";
  status: TransferStatus;
  createdAt: string;
  resolvedAt: string | null;
  txId: string | null; // the settled TRANSFER transaction, once approved
};

export type TxType =
  | "MINE"
  | "TRADE"
  | "TRANSFER"
  | "ESCROW_LOCK"
  | "ESCROW_REFUND"
  | "ADJUST"
  | "BURN"
  | "CONVERT" // a DC<->CC conversion leg (one DC-out row + one CC-in row)
  | "PURCHASE"; // DC bought with real money (credited by an admin)

/** Which coin a transaction moved. Legacy rows (pre-DC) default to "CC". */
export type Currency = "CC" | "DC";

export type Transaction = {
  seq: number;
  id: string;
  type: TxType;
  // Unit of `amountCC` below: "CC" or "DC". NOT part of the hash payload (an
  // additive annotation, like externalId), so all existing hashes stay valid.
  currency: Currency;
  fromEmail: string | null;
  toEmail: string | null;
  amountCC: number;
  offerId: string | null;
  memo: string;
  createdAt: string;
  prevHash: string;
  hash: string;
  // Optional external correlation id (e.g. a Google Chat message id) for trades
  // recorded by an integration. Used to make imports idempotent. Not part of the
  // hash payload — a purely additive annotation, so existing hashes are unaffected.
  externalId?: string | null;
};

export type LedgerState = {
  members: Member[];
  offers: Offer[];
  transactions: Transaction[];
  transfers: TransferRequest[];
  // Capsule Fruit Fund — running total (BDT) from DC bought with real money.
  // Maintained by the Fruit Minister (config.dc.fruitMinisterEmail).
  fruitFundBdt: number;
};

export class LedgerError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

// ── Firestore-backed store ──────────────────────────────────────────────────
// The whole ledger lives in ONE Firestore document (as JSON). Every mutation is
// a Firestore transaction (read → apply → write), which serializes concurrent
// writers across serverless instances — the same double-spend / hash-chain
// guarantee the old in-process single-writer queue gave, but durable and
// cloud-hosted. A 16-member ledger is a few KB; Firestore's 1 MB/document
// ceiling comfortably holds many thousands of transactions.
// Doc id is overridable (LEDGER_DOC_ID) so tests / staging can run against an
// isolated document without ever touching the live "state" ledger.
const ledgerRef = adminDb
  .collection("ledger")
  .doc(process.env.LEDGER_DOC_ID?.trim() || "state");

function emptyState(): LedgerState {
  return { members: [], offers: [], transactions: [], transfers: [], fruitFundBdt: 0 };
}

/**
 * Fill in fields added after some rows were already persisted, so old Firestore
 * documents (written before DC / grace / onboarding existed) load cleanly. Runs
 * on every read AND inside mutate()'s transaction, so drafts always carry them.
 */
function normalizeState(s: LedgerState): LedgerState {
  if (!s || typeof s !== "object") return emptyState();
  const members = Array.isArray(s.members) ? s.members : [];
  const transactions = Array.isArray(s.transactions) ? s.transactions : [];
  for (const m of members) {
    if (typeof m.dcBalance !== "number" || !Number.isFinite(m.dcBalance)) {
      m.dcBalance = 0;
    }
    if (m.graceUntil === undefined) m.graceUntil = null;
    if (typeof m.banned !== "boolean") m.banned = false;
    if (m.onboardedAt === undefined) m.onboardedAt = null;
  }
  for (const t of transactions) {
    if (t.currency !== "DC") t.currency = "CC";
  }
  return {
    members,
    offers: Array.isArray(s.offers) ? s.offers : [],
    transactions,
    transfers: Array.isArray(s.transfers) ? s.transfers : [],
    fruitFundBdt:
      typeof s.fruitFundBdt === "number" && Number.isFinite(s.fruitFundBdt)
        ? s.fruitFundBdt
        : 0,
  };
}

function parseState(json: unknown): LedgerState {
  if (typeof json !== "string") return emptyState();
  try {
    return normalizeState(JSON.parse(json) as LedgerState);
  } catch {
    return emptyState();
  }
}

// ── Cell helpers ────────────────────────────────────────────────────────────
function rawCell(row: ExcelJS.Row, col: number): unknown {
  const v = row.getCell(col).value as unknown;
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if ("result" in obj) return obj.result;
    if ("text" in obj) return obj.text;
  }
  return v;
}
function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1";
}
function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function toStr(v: unknown): string {
  return String(v ?? "");
}
function toStrOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

// ── Sheet schemas ───────────────────────────────────────────────────────────
const MEMBER_HEADERS = [
  "Email",
  "Name",
  "Balance (CC)",
  "Verified",
  "Role",
  "Last Mined (UTC)",
  "Joined (UTC)",
  "Mine Day",
  "Free Mines Used",
  "Paid Tier",
  "Paid Attempts Left",
  "DC Balance",
  "Grace Until (UTC)",
  "Banned",
  "Onboarded At (UTC)",
];
const OFFER_HEADERS = [
  "ID",
  "Type",
  "Creator Email",
  "Creator Name",
  "Item",
  "Category",
  "Description",
  "Price (CC)",
  "Status",
  "Counterparty Email",
  "Counterparty Name",
  "Escrow (CC)",
  "Created (UTC)",
  "Closed (UTC)",
];
const TX_HEADERS = [
  "Seq",
  "ID",
  "Type",
  "From",
  "To",
  "Amount (CC)",
  "Offer ID",
  "Memo",
  "Created (UTC)",
  "Prev Hash",
  "Hash",
  "Currency",
];
const REQUEST_HEADERS = [
  "ID",
  "Payer Email",
  "Payer Name",
  "Payee Email",
  "Payee Name",
  "Amount (CC)",
  "Item",
  "Note",
  "Initiated By",
  "Status",
  "Created (UTC)",
  "Resolved (UTC)",
  "Tx ID",
];

// ── Parsing ─────────────────────────────────────────────────────────────────
function parseMembers(wb: ExcelJS.Workbook): Member[] {
  const ws = wb.getWorksheet("Members");
  if (!ws) return [];
  const out: Member[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const email = toStr(rawCell(row, 1)).trim().toLowerCase();
    if (!email) return;
    out.push({
      email,
      name: toStr(rawCell(row, 2)),
      balance: toNum(rawCell(row, 3)),
      verified: toBool(rawCell(row, 4)),
      role: toStr(rawCell(row, 5)) || roleFor(email),
      lastMinedAt: toStrOrNull(rawCell(row, 6)),
      createdAt: toStr(rawCell(row, 7)) || new Date().toISOString(),
      mineDay: toStr(rawCell(row, 8)).trim(),
      freeMinesUsed: toNum(rawCell(row, 9)),
      paidTier: toNum(rawCell(row, 10)),
      paidRemaining: toNum(rawCell(row, 11)),
      dcBalance: toNum(rawCell(row, 12)),
      graceUntil: toStrOrNull(rawCell(row, 13)),
      banned: toBool(rawCell(row, 14)),
      onboardedAt: toStrOrNull(rawCell(row, 15)),
    });
  });
  return out;
}

function parseOffers(wb: ExcelJS.Workbook): Offer[] {
  const ws = wb.getWorksheet("Offers");
  if (!ws) return [];
  const out: Offer[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const id = toStr(rawCell(row, 1)).trim();
    if (!id) return;
    out.push({
      id,
      type: (toStr(rawCell(row, 2)).trim().toUpperCase() as OfferType) || "SELL",
      creatorEmail: toStr(rawCell(row, 3)).trim().toLowerCase(),
      creatorName: toStr(rawCell(row, 4)),
      itemName: toStr(rawCell(row, 5)),
      category: toStr(rawCell(row, 6)) || "Food",
      description: toStr(rawCell(row, 7)),
      priceCC: toNum(rawCell(row, 8)),
      status: (toStr(rawCell(row, 9)).trim().toUpperCase() as OfferStatus) || "OPEN",
      counterpartyEmail: toStrOrNull(rawCell(row, 10))?.toLowerCase() ?? null,
      counterpartyName: toStrOrNull(rawCell(row, 11)),
      escrowAmount: toNum(rawCell(row, 12)),
      createdAt: toStr(rawCell(row, 13)) || new Date().toISOString(),
      closedAt: toStrOrNull(rawCell(row, 14)),
    });
  });
  return out;
}

function parseTransactions(wb: ExcelJS.Workbook): Transaction[] {
  const ws = wb.getWorksheet("Transactions");
  if (!ws) return [];
  const out: Transaction[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const id = toStr(rawCell(row, 2)).trim();
    if (!id) return;
    out.push({
      seq: toNum(rawCell(row, 1)),
      id,
      type: (toStr(rawCell(row, 3)).trim().toUpperCase() as TxType) || "TRADE",
      currency: toStr(rawCell(row, 12)).trim().toUpperCase() === "DC" ? "DC" : "CC",
      fromEmail: toStrOrNull(rawCell(row, 4))?.toLowerCase() ?? null,
      toEmail: toStrOrNull(rawCell(row, 5))?.toLowerCase() ?? null,
      amountCC: toNum(rawCell(row, 6)),
      offerId: toStrOrNull(rawCell(row, 7)),
      memo: toStr(rawCell(row, 8)),
      createdAt: toStr(rawCell(row, 9)),
      prevHash: toStr(rawCell(row, 10)),
      hash: toStr(rawCell(row, 11)),
    });
  });
  return out;
}

function parseTransfers(wb: ExcelJS.Workbook): TransferRequest[] {
  const ws = wb.getWorksheet("Requests");
  if (!ws) return [];
  const out: TransferRequest[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const id = toStr(rawCell(row, 1)).trim();
    if (!id) return;
    out.push({
      id,
      fromEmail: toStr(rawCell(row, 2)).trim().toLowerCase(),
      fromName: toStr(rawCell(row, 3)),
      toEmail: toStr(rawCell(row, 4)).trim().toLowerCase(),
      toName: toStr(rawCell(row, 5)),
      amountCC: toNum(rawCell(row, 6)),
      item: toStr(rawCell(row, 7)),
      note: toStr(rawCell(row, 8)),
      initiatedBy:
        (toStr(rawCell(row, 9)).trim().toUpperCase() as "PAYER" | "PAYEE") ||
        "PAYEE",
      status:
        (toStr(rawCell(row, 10)).trim().toUpperCase() as TransferStatus) ||
        "PENDING",
      createdAt: toStr(rawCell(row, 11)) || new Date().toISOString(),
      resolvedAt: toStrOrNull(rawCell(row, 12)),
      txId: toStrOrNull(rawCell(row, 13)),
    });
  });
  return out;
}

// ── Read-path cache ─────────────────────────────────────────────────────────
// Every GET route reads the whole ledger doc through ensureLoaded(); a single page
// load hits several routes (me, leaderboard, transactions, value, transfers) and
// some routes read more than once. A short-lived in-process cache collapses those
// to one Firestore round trip per warm instance, and a single-flight promise
// dedupes concurrent reads within an instance. A commit primes the cache with the
// just-written state, so a mutation is never masked by a stale read on the same
// instance; cross-instance staleness is bounded by the (small) TTL. The cache
// holds the raw JSON and re-parses per call, so every caller still gets its own
// object — no shared-mutation risk. The write path (mutate) always reads fresh
// inside its transaction and never consults this cache.
const READ_TTL_MS = (() => {
  const n = Number(process.env.LEDGER_READ_TTL_MS);
  return Number.isFinite(n) && n >= 0 ? n : 1500;
})();
let rawCache: { json: string | undefined; at: number } | null = null;
let rawInflight: Promise<string | undefined> | null = null;

async function readRawJson(): Promise<string | undefined> {
  if (rawCache && Date.now() - rawCache.at < READ_TTL_MS) return rawCache.json;
  if (rawInflight) return rawInflight;
  rawInflight = (async () => {
    try {
      const snap = await ledgerRef.get();
      const json = snap.exists
        ? (snap.data()?.json as string | undefined)
        : undefined;
      rawCache = { json, at: Date.now() };
      return json;
    } finally {
      rawInflight = null;
    }
  })();
  return rawInflight;
}

/** Refresh the read cache with a known-fresh snapshot (called right after commit). */
function primeReadCache(json: string): void {
  rawCache = { json, at: Date.now() };
}

async function ensureLoaded(): Promise<LedgerState> {
  return parseState(await readRawJson());
}

// ── Building / persisting ───────────────────────────────────────────────────
async function protectSheet(ws: ExcelJS.Worksheet): Promise<void> {
  await ws.protect(config.ledger.password, {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
  });
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FF0B0E14" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF5C542" },
  };
  header.alignment = { vertical: "middle" };
}

async function buildWorkbook(next: LedgerState): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Capsule Coin";
  wb.created = new Date();
  wb.modified = new Date();

  const balances = next.members.reduce((s, m) => s + m.balance, 0);
  const escrow = next.offers
    .filter((o) => o.status === "OPEN")
    .reduce((s, o) => s + o.escrowAmount, 0);
  const openOffers = next.offers.filter((o) => o.status === "OPEN").length;

  // Info
  const info = wb.addWorksheet("Info");
  info.getColumn(1).width = 26;
  info.getColumn(2).width = 80;
  (
    [
      ["Capsule Coin — Master Ledger", ""],
      ["Generated (UTC)", new Date().toISOString()],
      ["Members", String(next.members.length)],
      ["Circulating balances (CC)", String(balances)],
      ["Escrow locked (CC)", String(escrow)],
      ["Total supply (CC)", String(balances + escrow)],
      ["Open offers", String(openOffers)],
      ["Transactions", String(next.transactions.length)],
      [
        "Note",
        "Live master ledger, regenerated by the server after every committed change. Read-only: sheets are protected and edits here do NOT affect balances.",
      ],
    ] as Array<[string, string]>
  ).forEach((r) => info.addRow(r));
  info.getRow(1).font = { bold: true, size: 16, color: { argb: "FFF5C542" } };

  // Members
  const ms = wb.addWorksheet("Members", { views: [{ state: "frozen", ySplit: 1 }] });
  ms.addRow(MEMBER_HEADERS);
  [34, 26, 16, 12, 10, 26, 26, 14, 16, 10, 18, 14, 26, 10, 26].forEach(
    (w, i) => (ms.getColumn(i + 1).width = w),
  );
  for (const m of next.members) {
    ms.addRow([
      m.email,
      m.name,
      m.balance,
      m.verified,
      m.role,
      m.lastMinedAt ?? "",
      m.createdAt,
      m.mineDay ?? "",
      m.freeMinesUsed ?? 0,
      m.paidTier ?? 0,
      m.paidRemaining ?? 0,
      m.dcBalance ?? 0,
      m.graceUntil ?? "",
      m.banned ?? false,
      m.onboardedAt ?? "",
    ]);
  }
  styleHeader(ms);

  // Offers
  const os = wb.addWorksheet("Offers", { views: [{ state: "frozen", ySplit: 1 }] });
  os.addRow(OFFER_HEADERS);
  [38, 8, 30, 22, 24, 14, 40, 12, 12, 30, 22, 12, 26, 26].forEach(
    (w, i) => (os.getColumn(i + 1).width = w),
  );
  for (const o of next.offers) {
    os.addRow([
      o.id,
      o.type,
      o.creatorEmail,
      o.creatorName,
      o.itemName,
      o.category,
      o.description,
      o.priceCC,
      o.status,
      o.counterpartyEmail ?? "",
      o.counterpartyName ?? "",
      o.escrowAmount,
      o.createdAt,
      o.closedAt ?? "",
    ]);
  }
  styleHeader(os);

  // Transactions (append-only, hash-chained)
  const ts = wb.addWorksheet("Transactions", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ts.addRow(TX_HEADERS);
  [8, 38, 14, 30, 30, 14, 38, 44, 26, 20, 20, 10].forEach(
    (w, i) => (ts.getColumn(i + 1).width = w),
  );
  for (const t of next.transactions) {
    ts.addRow([
      t.seq,
      t.id,
      t.type,
      t.fromEmail ?? "",
      t.toEmail ?? "",
      t.amountCC,
      t.offerId ?? "",
      t.memo,
      t.createdAt,
      t.prevHash,
      t.hash,
      t.currency,
    ]);
  }
  styleHeader(ts);

  // Requests (peer-to-peer transfer requests + approvals)
  const rs = wb.addWorksheet("Requests", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  rs.addRow(REQUEST_HEADERS);
  [38, 30, 22, 30, 22, 12, 24, 30, 12, 12, 26, 26, 38].forEach(
    (w, i) => (rs.getColumn(i + 1).width = w),
  );
  for (const r of next.transfers) {
    rs.addRow([
      r.id,
      r.fromEmail,
      r.fromName,
      r.toEmail,
      r.toName,
      r.amountCC,
      r.item,
      r.note,
      r.initiatedBy,
      r.status,
      r.createdAt,
      r.resolvedAt ?? "",
      r.txId ?? "",
    ]);
  }
  styleHeader(rs);

  await protectSheet(info);
  await protectSheet(ms);
  await protectSheet(os);
  await protectSheet(ts);
  await protectSheet(rs);
  return wb;
}

// Persistence lives in mutate() now: each write commits the whole ledger to a
// single Firestore document inside a transaction — no local files or backups.
// (Firestore keeps the data durable + replicated; the Google Sheet mirror and
// the on-demand .xlsx export remain the human-readable copies.)

// ── Serialized single-writer ────────────────────────────────────────────────
export async function readState(): Promise<LedgerState> {
  return structuredClone(await ensureLoaded());
}

/**
 * Best-effort mirror of the committed state to Google Sheets. Dynamically
 * imported so googleapis only loads when configured, and fully guarded so a
 * Sheets failure can never affect the ledger write.
 */
async function mirrorToSheets(snapshot: LedgerState): Promise<void> {
  try {
    const mod = await import("@/lib/sheets/sync");
    // Await (not fire-and-forget): on serverless the function is frozen the
    // instant it returns, so a background sync would never finish. syncNow is
    // a no-op when GOOGLE_SHEETS_ID is unset, and is fully guarded internally.
    await mod.syncNow(snapshot);
  } catch (e) {
    console.error("[sheets] mirror unavailable (non-fatal):", e);
  }
}

export async function mutate<T>(
  fn: (draft: LedgerState) => T | Promise<T>,
): Promise<T> {
  let result!: T;
  let committed: LedgerState | null = null;
  // A Firestore transaction serializes concurrent writers (auto-retry on
  // contention) — the same double-spend / hash-chain safety the old in-process
  // queue gave, now durable and correct across serverless instances. `fn` only
  // mutates the draft, so a retry simply re-applies it on fresh state.
  let committedJson = "";
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ledgerRef);
    const current = parseState(snap.exists ? snap.data()?.json : undefined);
    const draft = structuredClone(current);
    result = await fn(draft); // may throw -> transaction aborts, nothing written
    committedJson = JSON.stringify(draft);
    tx.set(ledgerRef, {
      json: committedJson,
      updatedAt: new Date().toISOString(),
    });
    committed = draft;
  });
  if (committed) {
    primeReadCache(committedJson); // reads on this instance are fresh immediately
    await mirrorToSheets(committed); // Google Sheet mirror (awaited: must finish before the serverless fn returns)
  }
  return result;
}

// ── Internal draft helpers ──────────────────────────────────────────────────
function ensureMemberDraft(
  draft: LedgerState,
  email: string,
  name: string,
): Member {
  const lower = email.trim().toLowerCase();
  let m = draft.members.find((x) => x.email === lower);
  if (!m) {
    m = {
      email: lower,
      name: name || lower,
      balance: 0,
      dcBalance: 0,
      // A member record can exist without its owner having signed in yet
      // (seeded balance, or a transfer counterparty). "verified" flips to true
      // only when they actually reach the app (getOrCreateMember via /api/me).
      verified: false,
      role: roleFor(lower),
      lastMinedAt: null,
      createdAt: new Date().toISOString(),
      mineDay: "",
      freeMinesUsed: 0,
      paidTier: 0,
      paidRemaining: 0,
      graceUntil: null,
      banned: false,
      onboardedAt: null,
    };
    draft.members.push(m);
  }
  return m;
}

/** A permanently-banned member can do nothing (used across all mutation paths). */
function assertNotBanned(m: Member): void {
  if (m.banned) {
    throw new LedgerError(
      "BANNED",
      "Your account is permanently banned (missed the credit-floor grace period). Contact an admin.",
    );
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve a member's credit-floor grace state in place:
 *   - climbed back to >= the soft floor  -> clear grace
 *   - grace deadline passed while still under -> permanent ban
 * Idempotent; call before any action or after any CC credit. Serverless has no
 * cron, so this lazily latches the ban the next time the member is touched.
 */
function refreshGrace(m: Member, nowMs: number): void {
  if (m.banned) return;
  if (!m.graceUntil) {
    // Below the soft floor with no countdown running yet — start the grace clock.
    // Normal spends start it via applyGraceAfterSpend (from the post-spend balance);
    // this catches every OTHER way a member can end up under −500 without a timer:
    // the one-time DC migration, an admin adjust, or an import. Idempotent.
    if (m.balance < config.balanceFloor) {
      m.graceUntil = new Date(nowMs + config.grace.graceDays * DAY_MS).toISOString();
    }
    return;
  }
  if (m.balance >= config.balanceFloor) {
    m.graceUntil = null; // recovered
  } else if (Date.parse(m.graceUntil) <= nowMs) {
    m.banned = true; // missed the deadline
    m.graceUntil = null;
  }
}

/** Non-mutating standing for reads/display. */
function effectiveStanding(m: Member, nowMs: number): "OK" | "GRACE" | "BANNED" {
  if (m.banned) return "BANNED";
  if (m.graceUntil) {
    if (m.balance >= config.balanceFloor) return "OK";
    return Date.parse(m.graceUntil) <= nowMs ? "BANNED" : "GRACE";
  }
  return "OK";
}

/** Guard for actions that need a fully-active member (mining) — no grace, no ban. */
function assertActive(m: Member, nowMs: number): void {
  refreshGrace(m, nowMs);
  assertNotBanned(m);
  if (m.graceUntil) {
    throw new LedgerError(
      "GRACE_LOCKED",
      `You're below the ${config.balanceFloor} CC floor. Sell or convert DC to recover before mining again.`,
    );
  }
}

/**
 * Guard for a CC outflow of `amount`. Blocks banned/in-grace members and the
 * absolute hard floor; crossing the SOFT floor is allowed (it starts grace via
 * applyGraceAfterSpend). Works for any spend: trades, transfers, escrow, fees.
 */
function assertCanSpendCc(m: Member, amount: number, nowMs: number): void {
  refreshGrace(m, nowMs);
  assertNotBanned(m);
  if (m.graceUntil) {
    throw new LedgerError(
      "GRACE_LOCKED",
      `You're below the ${config.balanceFloor} CC floor — you can only sell or convert DC until you recover. Spending is locked.`,
    );
  }
  if (round2(m.balance - amount) < config.grace.hardFloor) {
    throw new LedgerError(
      "INSUFFICIENT_FUNDS",
      `That would drop you below the ${config.grace.hardFloor} CC hard floor.`,
    );
  }
}

/** Guard for a member who is buying (DC or CC) — blocked while banned/in grace. */
function assertCanBuy(m: Member, nowMs: number): void {
  refreshGrace(m, nowMs);
  assertNotBanned(m);
  if (m.graceUntil) {
    throw new LedgerError(
      "GRACE_LOCKED",
      `You're below the ${config.balanceFloor} CC floor — recover (sell or convert DC) before buying.`,
    );
  }
}

/** After a CC outflow, start the grace countdown if the member just crossed the
 *  soft floor and isn't already in grace/banned. */
function applyGraceAfterSpend(m: Member, nowMs: number): void {
  if (m.banned || m.graceUntil) return;
  if (m.balance < config.balanceFloor) {
    m.graceUntil = new Date(nowMs + config.grace.graceDays * DAY_MS).toISOString();
  }
}

function appendTransaction(
  draft: LedgerState,
  data: {
    type: TxType;
    currency?: Currency; // defaults to "CC" when omitted
    fromEmail: string | null;
    toEmail: string | null;
    amountCC: number;
    offerId: string | null;
    memo: string;
    createdAt?: string; // optional real timestamp (history import); defaults to now
    externalId?: string | null; // optional integration correlation id (not hashed)
  },
): Transaction {
  const seq = draft.transactions.length + 1;
  const prevHash =
    draft.transactions.length > 0
      ? draft.transactions[draft.transactions.length - 1].hash
      : "GENESIS";
  const createdAt = data.createdAt ?? new Date().toISOString();
  const id = randomUUID();
  const payload = [
    seq,
    data.type,
    data.fromEmail ?? "",
    data.toEmail ?? "",
    data.amountCC,
    data.offerId ?? "",
    createdAt,
    data.memo,
  ].join("|");
  const hash = createHash("sha256")
    .update(`${prevHash}|${payload}`)
    .digest("hex");
  const tx: Transaction = {
    seq,
    id,
    ...data,
    currency: data.currency ?? "CC",
    createdAt,
    prevHash,
    hash,
  };
  draft.transactions.push(tx);
  return tx;
}

// ── Members (Phase 2/3) ─────────────────────────────────────────────────────
export async function getOrCreateMember(
  email: string,
  fallbackName: string,
): Promise<Member> {
  const lower = email.trim().toLowerCase();
  const role = roleFor(lower);
  // Fast path: an already-verified member with the right role needs no write.
  // /api/me runs on every page load, so skipping the transaction here (and its
  // awaited Google Sheet mirror sync) takes a full ledger write off the hot path —
  // the common case becomes a single cached read.
  const existing = (await ensureLoaded()).members.find((x) => x.email === lower);
  const now = Date.now();
  // Lazily resolve grace on the member's own page load: recovered -> clear it,
  // deadline passed -> latch the permanent ban. Only forces a write when the
  // state actually needs to change, so the common case stays a cached read.
  // Grace is out of sync with the balance and a write is needed to latch it when:
  //  - a countdown is running that should now clear (recovered) or ban (deadline passed), OR
  //  - no countdown is running but the member is under the soft floor and one must START
  //    (e.g. placed there by the DC migration or an admin adjust — see refreshGrace).
  const graceNeedsResolve =
    !!existing &&
    !existing.banned &&
    (existing.graceUntil
      ? existing.balance >= config.balanceFloor ||
        Date.parse(existing.graceUntil) <= now
      : existing.balance < config.balanceFloor);
  if (
    existing &&
    existing.verified &&
    existing.role === role &&
    !graceNeedsResolve
  ) {
    return structuredClone(existing);
  }
  return mutate((draft) => {
    let m = draft.members.find((x) => x.email === lower);
    if (!m) m = ensureMemberDraft(draft, lower, fallbackName);
    // Reaching /api/me means the email was verified and the app was entered.
    m.verified = true;
    m.role = role;
    refreshGrace(m, Date.now());
    return { ...m };
  });
}

export async function getMember(email: string): Promise<Member | null> {
  const lower = email.trim().toLowerCase();
  const s = await ensureLoaded();
  return s.members.find((x) => x.email === lower) ?? null;
}

/** Mark the first-login DC story as seen (idempotent — set once). */
export async function markOnboarded(email: string): Promise<{ onboardedAt: string }> {
  const lower = email.trim().toLowerCase();
  return mutate((draft) => {
    const m = ensureMemberDraft(draft, lower, allowlistEntry(lower)?.name || lower);
    if (!m.onboardedAt) m.onboardedAt = new Date().toISOString();
    return { onboardedAt: m.onboardedAt };
  });
}

export async function listMembers(): Promise<Member[]> {
  return structuredClone((await ensureLoaded()).members);
}

// ── Offers & trades (Phase 4) ───────────────────────────────────────────────
export async function listOffers(): Promise<Offer[]> {
  return structuredClone((await ensureLoaded()).offers);
}

export async function createOffer(
  actor: { email: string; name: string },
  input: {
    type: OfferType;
    itemName: string;
    category?: string;
    description?: string;
    priceCC: number;
  },
): Promise<{ offer: Offer; balance: number }> {
  return mutate((draft) => {
    const me = ensureMemberDraft(draft, actor.email, actor.name);
    const price = Math.floor(Number(input.priceCC));
    if (!Number.isFinite(price) || price <= 0) {
      throw new LedgerError("INVALID", "Price must be a positive whole number of CC.");
    }
    const itemName = (input.itemName || "").trim();
    if (!itemName) throw new LedgerError("INVALID", "Item name is required.");

    let escrowAmount = 0;
    if (input.type === "BUY") {
      const now = Date.now();
      assertCanSpendCc(me, price, now); // buying is locked while banned / in grace
      me.balance = round2(me.balance - price);
      applyGraceAfterSpend(me, now);
      escrowAmount = price;
    }

    const offer: Offer = {
      id: randomUUID(),
      type: input.type,
      creatorEmail: me.email,
      creatorName: me.name,
      itemName,
      category: (input.category || "Food").trim() || "Food",
      description: (input.description || "").trim(),
      priceCC: price,
      status: "OPEN",
      counterpartyEmail: null,
      counterpartyName: null,
      escrowAmount,
      createdAt: new Date().toISOString(),
      closedAt: null,
    };
    draft.offers.push(offer);

    if (input.type === "BUY") {
      appendTransaction(draft, {
        type: "ESCROW_LOCK",
        fromEmail: me.email,
        toEmail: null,
        amountCC: price,
        offerId: offer.id,
        memo: `Escrow locked for buy request: ${itemName}`,
      });
    }
    return { offer: { ...offer }, balance: me.balance };
  });
}

export async function cancelOffer(
  actorEmail: string,
  offerId: string,
): Promise<{ offer: Offer; balance: number | null }> {
  const email = actorEmail.trim().toLowerCase();
  return mutate((draft) => {
    const offer = draft.offers.find((o) => o.id === offerId);
    if (!offer) throw new LedgerError("OFFER_NOT_FOUND", "Offer not found.");
    if (offer.creatorEmail !== email) {
      throw new LedgerError("NOT_CREATOR", "Only the creator can cancel this offer.");
    }
    if (offer.status !== "OPEN") {
      throw new LedgerError("OFFER_NOT_OPEN", "This offer is no longer open.");
    }
    offer.status = "CANCELLED";
    offer.closedAt = new Date().toISOString();

    let balance: number | null = null;
    if (offer.type === "BUY" && offer.escrowAmount > 0) {
      const me = draft.members.find((m) => m.email === email);
      const refund = offer.escrowAmount;
      if (me) {
        me.balance = round2(me.balance + refund);
        refreshGrace(me, Date.now()); // refund may lift them out of grace
        balance = me.balance;
      }
      appendTransaction(draft, {
        type: "ESCROW_REFUND",
        fromEmail: null,
        toEmail: email,
        amountCC: refund,
        offerId: offer.id,
        memo: `Escrow refunded for cancelled buy request: ${offer.itemName}`,
      });
      offer.escrowAmount = 0;
    }
    return { offer: { ...offer }, balance };
  });
}

export async function acceptOffer(
  actor: { email: string; name: string },
  offerId: string,
): Promise<{ offer: Offer; balance: number }> {
  return mutate((draft) => {
    const me = ensureMemberDraft(draft, actor.email, actor.name);
    const offer = draft.offers.find((o) => o.id === offerId);
    if (!offer) throw new LedgerError("OFFER_NOT_FOUND", "Offer not found.");
    if (offer.status !== "OPEN") {
      throw new LedgerError(
        "OFFER_NOT_OPEN",
        "This offer was just taken or cancelled.",
      );
    }
    if (offer.creatorEmail === me.email) {
      throw new LedgerError("SELF_TRADE", "You can't accept your own offer.");
    }

    const price = offer.priceCC;
    const creator = draft.members.find((m) => m.email === offer.creatorEmail);

    const now = Date.now();
    if (offer.type === "SELL") {
      // actor is the buyer, pays the seller
      assertCanSpendCc(me, price, now); // locked while banned / in grace
      me.balance = round2(me.balance - price);
      applyGraceAfterSpend(me, now);
      if (creator) {
        creator.balance = round2(creator.balance + price);
        refreshGrace(creator, now);
      }
      appendTransaction(draft, {
        type: "TRADE",
        fromEmail: me.email,
        toEmail: offer.creatorEmail,
        amountCC: price,
        offerId: offer.id,
        memo: `Bought "${offer.itemName}"`,
      });
    } else {
      // BUY: actor fulfills the request and receives the escrowed CC (a sale —
      // allowed in grace, blocked only if permanently banned).
      assertNotBanned(me);
      me.balance = round2(me.balance + price);
      refreshGrace(me, now);
      appendTransaction(draft, {
        type: "TRADE",
        fromEmail: offer.creatorEmail,
        toEmail: me.email,
        amountCC: price,
        offerId: offer.id,
        memo: `Fulfilled buy request "${offer.itemName}"`,
      });
      offer.escrowAmount = 0;
    }

    offer.status = "COMPLETED";
    offer.counterpartyEmail = me.email;
    offer.counterpartyName = me.name;
    offer.closedAt = new Date().toISOString();
    return { offer: { ...offer }, balance: me.balance };
  });
}

// ── Transactions ────────────────────────────────────────────────────────────
export async function listTransactionsFor(
  email: string,
): Promise<Transaction[]> {
  const e = email.trim().toLowerCase();
  const txs = (await ensureLoaded()).transactions.filter(
    (t) => t.fromEmail === e || t.toEmail === e,
  );
  return structuredClone(txs).sort((a, b) => b.seq - a.seq);
}

// ── Peer-to-peer transfers (request → payer approval) ───────────────────────
export async function listTransfers(): Promise<TransferRequest[]> {
  return structuredClone((await ensureLoaded()).transfers);
}

/**
 * Silently expire PENDING transfer requests older than the configured TTL.
 * A pending request never escrows CC (nothing moves until the payer approves),
 * so expiring is a pure status flip — no balance change, no ledger transaction.
 * Serverless has no cron, so this is called lazily on transfer reads. It reads
 * first and only opens a write transaction when something is actually stale.
 * Returns the number expired.
 */
export async function expireStaleTransfers(now = Date.now()): Promise<number> {
  const cutoff = now - config.transfers.ttlMs;
  const state = await ensureLoaded();
  const hasStale = state.transfers.some(
    (t) => t.status === "PENDING" && Date.parse(t.createdAt) < cutoff,
  );
  if (!hasStale) return 0;
  return mutate((draft) => {
    let n = 0;
    const iso = new Date(now).toISOString();
    for (const t of draft.transfers) {
      if (t.status === "PENDING" && Date.parse(t.createdAt) < cutoff) {
        t.status = "EXPIRED";
        t.resolvedAt = iso;
        n++;
      }
    }
    return n;
  });
}

/** Move CC from payer to payee and append the TRANSFER transaction. */
function settleTransfer(draft: LedgerState, t: TransferRequest): Transaction {
  const now = Date.now();
  const payer = ensureMemberDraft(draft, t.fromEmail, t.fromName);
  const payee = ensureMemberDraft(draft, t.toEmail, t.toName);
  payer.balance = round2(payer.balance - t.amountCC);
  payee.balance = round2(payee.balance + t.amountCC);
  applyGraceAfterSpend(payer, now); // may cross into grace
  refreshGrace(payee, now); // credit may lift the payee out of grace
  return appendTransaction(draft, {
    type: "TRANSFER",
    fromEmail: payer.email,
    toEmail: payee.email,
    amountCC: t.amountCC,
    offerId: null,
    memo: `${t.item}${t.note ? ` — ${t.note}` : ""}`,
  });
}

export async function createTransfer(
  actor: { email: string; name: string },
  input: {
    direction: "REQUEST" | "SEND";
    counterpartyEmail: string;
    amountCC: number;
    item: string;
    note?: string;
  },
): Promise<{ transfer: TransferRequest; balance: number | null }> {
  return mutate((draft) => {
    const me = ensureMemberDraft(draft, actor.email, actor.name);
    const other = input.counterpartyEmail.trim().toLowerCase();
    if (!other) throw new LedgerError("INVALID", "Pick who the transfer is with.");
    if (other === me.email)
      throw new LedgerError("SELF_TRANSFER", "You can't transfer with yourself.");
    if (!isAllowed(other))
      throw new LedgerError("INVALID", "That person isn't a Capsule member.");
    const amount = round2(Number(input.amountCC));
    if (!Number.isFinite(amount) || amount <= 0)
      throw new LedgerError("INVALID", "Amount must be more than 0 CC.");
    const item = (input.item || "").trim();
    if (!item) throw new LedgerError("INVALID", "Say what the CC is for.");
    const note = (input.note || "").trim();

    const counterparty = ensureMemberDraft(
      draft,
      other,
      allowlistEntry(other)?.name || other,
    );
    const payer = input.direction === "SEND" ? me : counterparty;
    const payee = input.direction === "SEND" ? counterparty : me;

    const transfer: TransferRequest = {
      id: randomUUID(),
      fromEmail: payer.email,
      fromName: payer.name,
      toEmail: payee.email,
      toName: payee.name,
      amountCC: amount,
      item,
      note,
      initiatedBy: input.direction === "SEND" ? "PAYER" : "PAYEE",
      status: "PENDING",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      txId: null,
    };

    if (input.direction === "SEND") {
      // Payer is the initiator → consent is implicit → settle immediately.
      assertCanSpendCc(payer, amount, Date.now()); // locked while banned / in grace
      const tx = settleTransfer(draft, transfer);
      transfer.status = "APPROVED";
      transfer.resolvedAt = new Date().toISOString();
      transfer.txId = tx.id;
      draft.transfers.push(transfer);
      return { transfer: { ...transfer }, balance: payer.balance };
    }

    // REQUEST → sits pending until the payer approves.
    draft.transfers.push(transfer);
    return { transfer: { ...transfer }, balance: null };
  });
}

export async function approveTransfer(
  actorEmail: string,
  id: string,
): Promise<{ transfer: TransferRequest; balance: number }> {
  const email = actorEmail.trim().toLowerCase();
  return mutate((draft) => {
    const t = draft.transfers.find((x) => x.id === id);
    if (!t) throw new LedgerError("NOT_FOUND", "That request no longer exists.");
    if (t.status !== "PENDING")
      throw new LedgerError("NOT_PENDING", "This request was already resolved.");
    if (t.fromEmail !== email)
      throw new LedgerError("NOT_PAYER", "Only the payer can approve this.");
    const payer = ensureMemberDraft(draft, t.fromEmail, t.fromName);
    assertCanSpendCc(payer, t.amountCC, Date.now()); // locked while banned / in grace
    const tx = settleTransfer(draft, t);
    t.status = "APPROVED";
    t.resolvedAt = new Date().toISOString();
    t.txId = tx.id;
    return { transfer: { ...t }, balance: payer.balance };
  });
}

export async function declineTransfer(
  actorEmail: string,
  id: string,
): Promise<{ transfer: TransferRequest }> {
  const email = actorEmail.trim().toLowerCase();
  return mutate((draft) => {
    const t = draft.transfers.find((x) => x.id === id);
    if (!t) throw new LedgerError("NOT_FOUND", "That request no longer exists.");
    if (t.status !== "PENDING")
      throw new LedgerError("NOT_PENDING", "This request was already resolved.");
    if (t.fromEmail !== email)
      throw new LedgerError("NOT_PAYER", "Only the payer can decline this.");
    t.status = "DECLINED";
    t.resolvedAt = new Date().toISOString();
    return { transfer: { ...t } };
  });
}

export async function cancelTransfer(
  actorEmail: string,
  id: string,
): Promise<{ transfer: TransferRequest }> {
  const email = actorEmail.trim().toLowerCase();
  return mutate((draft) => {
    const t = draft.transfers.find((x) => x.id === id);
    if (!t) throw new LedgerError("NOT_FOUND", "That request no longer exists.");
    if (t.status !== "PENDING")
      throw new LedgerError("NOT_PENDING", "This request was already resolved.");
    const initiatorEmail = t.initiatedBy === "PAYER" ? t.fromEmail : t.toEmail;
    if (initiatorEmail !== email)
      throw new LedgerError(
        "NOT_CREATOR",
        "Only whoever created this request can cancel it.",
      );
    t.status = "CANCELLED";
    t.resolvedAt = new Date().toISOString();
    return { transfer: { ...t } };
  });
}

// ── DesertHouse (Google Chat) auto-recorded trades ──────────────────────────
/** Marker appended to the memo so DesertHouse-sourced trades are visible in both
 *  the app ledger and the Google Sheet mirror without any schema change. */
export const DESERT_HOUSE_MEMO_TAG = "via DesertHouse";

/**
 * Normalize an email that may arrive decorated by an AI/Chat step — e.g.
 * "mailto:a@b.com", "<a@b.com>", or a markdown link. Extracts the bare address
 * so it can be matched against the allowlist; falls back to the cleaned string.
 */
function cleanEmail(s: string): string {
  const v = String(s || "")
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/[<>]/g, "")
    .trim()
    .toLowerCase();
  const m = v.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0] : v;
}

export type DesertHouseTradeResult = {
  recorded: boolean; // false when it was a duplicate (no-op)
  duplicate: boolean;
  txId: string | null;
  amountCC: number;
  item: string;
  currency: Currency; // "CC" (food) or "DC" (non-food)
  seller: { email: string; name: string; balance: number; dcBalance: number };
  buyer: { email: string; name: string; balance: number; dcBalance: number };
  message: string; // human line the flow can echo back into the space
};

/**
 * Record a trade parsed from a DesertHouse (Google Chat) message. It settles
 * immediately — buyer pays, seller receives — exactly like an approved transfer,
 * so the app UI and Sheet mirror update through the normal mutate() path.
 *
 * Safety: both parties must be allowlisted members, they must differ, and the
 * message author must be one of them (you can only record your own trades). The
 * amount is bounded and the payer's floor is enforced. If an externalId (the Chat
 * message id) is supplied and already recorded, this is a no-op — a re-fired flow
 * or re-delivered message can never double-charge.
 */
export async function recordDesertHouseTrade(input: {
  sellerEmail: string; // receives the coin
  buyerEmail: string; // pays the coin
  amountCC: number; // amount, in `currency` units
  item: string;
  authorEmail: string; // Chat message author — must be the buyer or seller
  currency?: Currency; // "CC" for food, "DC" for non-food (Gemini-classified). Default CC.
  externalId?: string; // Chat message id, for idempotency
  rawText?: string; // original message text (audit only)
}): Promise<DesertHouseTradeResult> {
  const sellerEmail = cleanEmail(input.sellerEmail);
  const buyerEmail = cleanEmail(input.buyerEmail);
  const authorEmail = cleanEmail(input.authorEmail);
  const item = (input.item || "").trim();
  const amount = round2(Number(input.amountCC));
  const externalId = (input.externalId || "").trim();
  const cur: Currency = input.currency === "DC" ? "DC" : "CC";

  return mutate((draft): DesertHouseTradeResult => {
    // ── Validate ──────────────────────────────────────────────────────────
    if (!isAllowed(sellerEmail) || !isAllowed(buyerEmail)) {
      throw new LedgerError(
        "NOT_MEMBER",
        "Both the seller and buyer must be Capsule members.",
      );
    }
    if (sellerEmail === buyerEmail) {
      throw new LedgerError(
        "SELF_TRADE",
        "The seller and buyer can't be the same person.",
      );
    }
    if (authorEmail !== sellerEmail && authorEmail !== buyerEmail) {
      throw new LedgerError(
        "NOT_PARTICIPANT",
        "You can only record a trade you took part in.",
      );
    }
    if (!item) throw new LedgerError("INVALID", "Say what was traded.");
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new LedgerError("INVALID", "The amount must be more than 0 CC.");
    }
    if (amount > config.desertHouse.maxCc) {
      throw new LedgerError(
        "INVALID",
        `That amount looks too large (max ${config.desertHouse.maxCc} CC) — please record big trades in the app.`,
      );
    }

    const seller = ensureMemberDraft(
      draft,
      sellerEmail,
      allowlistEntry(sellerEmail)?.name || sellerEmail,
    );
    const buyer = ensureMemberDraft(
      draft,
      buyerEmail,
      allowlistEntry(buyerEmail)?.name || buyerEmail,
    );

    // ── Idempotency: a re-fired flow / re-delivered message is a no-op ─────
    if (externalId) {
      const prior = draft.transactions.find((t) => t.externalId === externalId);
      if (prior) {
        return {
          recorded: false,
          duplicate: true,
          txId: prior.id,
          amountCC: prior.amountCC,
          item: prior.memo,
          currency: prior.currency,
          seller: { email: seller.email, name: seller.name, balance: seller.balance, dcBalance: seller.dcBalance },
          buyer: { email: buyer.email, name: buyer.name, balance: buyer.balance, dcBalance: buyer.dcBalance },
          message: `Already recorded — no change.`,
        };
      }
    }

    // ── Settle: buyer pays, seller receives (in the trade's currency) ─────
    const now = Date.now();
    assertNotBanned(seller); // a banned member can't transact at all
    if (cur === "DC") {
      assertCanBuy(buyer, now); // buying is locked while banned / in grace
      // DC has no credit line — the buyer must actually hold the DC.
      if (round2(buyer.dcBalance) < amount) {
        throw new LedgerError(
          "INSUFFICIENT_DC",
          `${buyer.name} only has ${round2(buyer.dcBalance)} DC (need ${amount}).`,
        );
      }
      buyer.dcBalance = round2(buyer.dcBalance - amount);
      seller.dcBalance = round2(seller.dcBalance + amount);
    } else {
      // CC food trade. Crossing the soft floor is allowed (it starts grace);
      // only the hard floor is a wall, and grace/ban block spending entirely.
      assertCanSpendCc(buyer, amount, now);
      buyer.balance = round2(buyer.balance - amount);
      seller.balance = round2(seller.balance + amount);
      applyGraceAfterSpend(buyer, now);
    }
    refreshGrace(seller, now); // a CC credit may lift the seller out of grace
    const tx = appendTransaction(draft, {
      type: "TRANSFER",
      currency: cur,
      fromEmail: buyer.email,
      toEmail: seller.email,
      amountCC: amount,
      offerId: null,
      memo: `${item} · ${DESERT_HOUSE_MEMO_TAG}`,
      externalId: externalId || null,
    });

    const bal = (m: Member) =>
      cur === "DC" ? `${m.dcBalance} DC` : `${m.balance} CC`;
    return {
      recorded: true,
      duplicate: false,
      txId: tx.id,
      amountCC: amount,
      item,
      currency: cur,
      seller: { email: seller.email, name: seller.name, balance: seller.balance, dcBalance: seller.dcBalance },
      buyer: { email: buyer.email, name: buyer.name, balance: buyer.balance, dcBalance: buyer.dcBalance },
      message: `✅ Recorded (${cur}): ${item} — ${seller.name} +${amount} ${cur}, ${buyer.name} -${amount} ${cur}. New balances: ${seller.name} ${bal(seller)}, ${buyer.name} ${bal(buyer)}.`,
    };
  });
}

// ── Mining v2 — collision-lottery (Phase 5 rebuild) ─────────────────────────
function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10); // UTC yyyy-mm-dd
}

/** Next daily refill boundary: the upcoming UTC midnight. */
function nextResetMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

/** Roll a member's daily allowance over if we've crossed into a new UTC day. */
function applyDailyReset(m: Member, nowMs: number): void {
  const today = dayKey(nowMs);
  if (m.mineDay !== today) {
    m.mineDay = today;
    m.freeMinesUsed = 0;
    m.paidTier = 0;
    m.paidRemaining = 0;
  }
}

/**
 * Net CC still mintable before hitting the fixed supply cap. Burned fees add
 * headroom back (fee recycling), so an active economy keeps mining alive — but
 * total mined − burned can never exceed supplyCap. This bounds inflation.
 */
function reserveRemaining(s: LedgerState): number {
  // Mining now mints DC. The fixed supplyCap bounds net mined DC in circulation;
  // converting DC->CC destroys DC and reopens that headroom (the DC-native analog
  // of the old fee-recycling), so an active economy keeps mining alive. Paid-mining
  // CC BURNs no longer refill the reserve — they're a different currency now.
  let minedDc = 0;
  let convertedDc = 0;
  for (const tx of s.transactions) {
    if (tx.currency !== "DC") continue;
    if (tx.type === "MINE") minedDc += tx.amountCC;
    else if (tx.type === "CONVERT") convertedDc += tx.amountCC;
  }
  const used = Math.max(0, minedDc - convertedDc);
  return round2(config.mining.supplyCap - used);
}

/**
 * Fast uniform ints in [0, mod) drawn from crypto bytes — 6 bytes (48-bit) each
 * so keyspaces up to 2^48 work. (A 4-byte read maxes at 2^32≈4.29e9, which
 * silently capped any larger keyspace and made big free values behave the same.)
 */
function randomIntsMod(n: number, mod: number): number[] {
  const buf = randomBytes(n * 6);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = buf.readUIntBE(i * 6, 6) % mod;
  return out;
}

/**
 * One collision-lottery run against a keyspace. Generates a secret set and the
 * player's set (both `tokensPerSide` tokens), counts distinct collisions, and
 * pays U(matchMin, matchMax) CC per match, capped at rewardCap. Pure math — no
 * ledger writes. The secret set never leaves the server.
 */
function runLottery(
  keyspaceN: number,
  rewardScale = 1,
): { matches: number; reward: number } {
  const size = Math.max(1, Math.floor(config.mining.tokensPerSide));
  const mod = Math.max(2, Math.floor(keyspaceN));

  const secret = new Set<number>();
  const secretTokens = randomIntsMod(size, mod);
  for (let i = 0; i < size; i++) secret.add(secretTokens[i]);

  const playerTokens = randomIntsMod(size, mod);
  const counted = new Set<number>();
  let matches = 0;
  for (let i = 0; i < size; i++) {
    const t = playerTokens[i];
    if (secret.has(t) && !counted.has(t)) {
      counted.add(t);
      matches++;
    }
  }

  const { matchMin, matchMax, rewardCap } = config.mining;
  let reward = 0;
  for (let i = 0; i < matches; i++) {
    reward += matchMin + (matchMax - matchMin) * (randomInt(0, 1_000_001) / 1_000_000);
  }
  // Taper the per-match payout (keyspace/matches are untouched — only the CC each
  // match is worth scales down as the reserve depletes; see mine()).
  reward *= rewardScale;
  return { matches, reward: Math.min(reward, rewardCap) };
}

/**
 * Free-tier reward multiplier: 1.0 while the reserve is full, stepping down once
 * per `rewardTaperStepCC` of NET CC mined, to a floor of one step's worth at the
 * last bracket. With supplyCap 1000 / step 100 → scales 1.0, 0.9, 0.8 … 0.1.
 * Returns 1 (no taper) when the step is disabled.
 */
function freeRewardScale(netMined: number): number {
  const step = config.mining.rewardTaperStepCC;
  if (!Number.isFinite(step) || step <= 0) return 1;
  const totalBrackets = Math.max(1, Math.ceil(config.mining.supplyCap / step));
  const bracket = Math.min(
    totalBrackets - 1,
    Math.max(0, Math.floor(netMined / step)),
  );
  return (totalBrackets - bracket) / totalBrackets;
}

function nextTierFor(m: Member): MiningTier | null {
  const t = config.mining.ladder[m.paidTier];
  return t ? { index: m.paidTier, fee: t.fee, mines: t.mines } : null;
}

export async function mineStatus(email: string): Promise<MiningStatus> {
  const s = await ensureLoaded();
  const now = Date.now();
  const lower = email.trim().toLowerCase();
  const found = s.members.find((m) => m.email === lower);
  // Compute the effective (post-reset) view without persisting — the actual
  // reset is committed on the next mine()/buyMiningPack() mutation.
  const m: Member = found
    ? structuredClone(found)
    : {
        email: lower,
        name: lower,
        balance: 0,
        dcBalance: 0,
        verified: true,
        role: roleFor(lower),
        lastMinedAt: null,
        createdAt: new Date().toISOString(),
        mineDay: "",
        freeMinesUsed: 0,
        paidTier: 0,
        paidRemaining: 0,
        graceUntil: null,
        banned: false,
        onboardedAt: null,
      };
  applyDailyReset(m, now);

  const reserve = reserveRemaining(s);
  const freeRemaining = Math.max(0, config.mining.freePerDay - m.freeMinesUsed);
  const hasAttempt = freeRemaining > 0 || m.paidRemaining > 0;
  const standing = effectiveStanding(m, now);

  return {
    freeRemaining,
    freePerDay: config.mining.freePerDay,
    paidRemaining: m.paidRemaining,
    tier: m.paidTier,
    nextTier: nextTierFor(m),
    canMine: hasAttempt && reserve > 0 && standing === "OK",
    balance: round2(m.balance),
    dcBalance: round2(m.dcBalance),
    reserveRemaining: reserve,
    supplyCap: config.mining.supplyCap,
    rewardCap: config.mining.rewardCap,
    tokensPerSide: config.mining.tokensPerSide,
    balanceFloor: config.balanceFloor,
    resetsAtMs: nextResetMs(now),
    standing,
    graceUntil: m.graceUntil,
  };
}

export async function mine(actor: {
  email: string;
  name: string;
}): Promise<MineOutcome> {
  return mutate((draft) => {
    const me = ensureMemberDraft(draft, actor.email, actor.name);
    const now = Date.now();
    applyDailyReset(me, now);
    assertActive(me, now); // no mining while banned / in credit-floor grace

    const freeLeft = config.mining.freePerDay - me.freeMinesUsed;
    const paid = freeLeft <= 0;
    if (paid && me.paidRemaining <= 0) {
      throw new LedgerError(
        "NO_ATTEMPTS",
        "No mining attempts left today — unlock a pay-to-mine pack below.",
      );
    }

    const reserve = reserveRemaining(draft);
    if (reserve <= 0) {
      throw new LedgerError(
        "RESERVE_EMPTY",
        "The mining reserve is tapped out right now — burned fees will reopen it.",
      );
    }

    // Free uses the lean keyspace; a paid mine uses the keyspace of the tier the
    // member is currently on (paidTier is 1-based → ladder index paidTier-1),
    // so higher tiers mine richer.
    const keyspace = paid
      ? config.mining.ladder[Math.max(0, me.paidTier - 1)]?.keyspace ??
        config.mining.keyspaceFree
      : config.mining.keyspaceFree;
    // Keyspace N is fixed; only the free-tier per-match payout tapers as the fixed
    // reserve is mined out (paid mines always pay the full range).
    const netMined = Math.max(0, config.mining.supplyCap - reserve);
    const rewardScale = paid ? 1 : freeRewardScale(netMined);
    const { matches, reward: rawReward } = runLottery(keyspace, rewardScale);
    const hitCap = rawReward >= config.mining.rewardCap;
    const reward = round2(Math.min(rawReward, reserve)); // never mint past the cap

    if (paid) me.paidRemaining -= 1;
    else me.freeMinesUsed += 1;

    me.dcBalance = round2(me.dcBalance + reward);
    me.lastMinedAt = new Date(now).toISOString();

    appendTransaction(draft, {
      type: "MINE",
      currency: "DC",
      fromEmail: null,
      toEmail: me.email,
      amountCC: reward,
      offerId: null,
      memo: `Mined ${reward} DC — ${matches} match${matches === 1 ? "" : "es"}${
        paid ? " (boosted)" : ""
      }`,
    });

    return {
      reward,
      matches,
      boosted: paid,
      capped: hitCap && reward >= config.mining.rewardCap,
      balance: me.balance,
      dcBalance: me.dcBalance,
      freeRemaining: Math.max(0, config.mining.freePerDay - me.freeMinesUsed),
      paidRemaining: me.paidRemaining,
      reserveRemaining: round2(reserve - reward),
    };
  });
}

/** Buy the next pay-to-mine pack (in ladder order). The fee is burned. */
export async function buyMiningPack(actor: {
  email: string;
  name: string;
}): Promise<BuyPackOutcome> {
  return mutate((draft) => {
    const me = ensureMemberDraft(draft, actor.email, actor.name);
    const now = Date.now();
    applyDailyReset(me, now);
    assertActive(me, now); // no pack purchases while banned / in credit-floor grace

    if (config.mining.freePerDay - me.freeMinesUsed > 0) {
      throw new LedgerError("FREE_LEFT", "Use your free mines first.");
    }
    if (me.paidRemaining > 0) {
      throw new LedgerError(
        "HAVE_ATTEMPTS",
        "Finish your current mining attempts first.",
      );
    }
    const tier = config.mining.ladder[me.paidTier];
    if (!tier) {
      throw new LedgerError(
        "MAXED",
        "You've unlocked every mining pack for today.",
      );
    }
    if (me.balance - tier.fee < config.balanceFloor) {
      throw new LedgerError(
        "INSUFFICIENT_FUNDS",
        `Not enough CC — paying ${tier.fee} CC would drop you below the ${config.balanceFloor} CC floor.`,
      );
    }

    me.balance = round2(me.balance - tier.fee);
    me.paidTier += 1;
    me.paidRemaining = tier.mines;

    appendTransaction(draft, {
      type: "BURN",
      fromEmail: me.email,
      toEmail: null,
      amountCC: tier.fee,
      offerId: null,
      memo: `Burned ${tier.fee} CC to unlock ${tier.mines} mining attempts`,
    });

    return {
      balance: me.balance,
      tier: me.paidTier,
      paidRemaining: me.paidRemaining,
      nextTier: nextTierFor(me),
      fee: tier.fee,
      mines: tier.mines,
    };
  });
}

// ── Dark Capsule Coin: DC <-> CC conversion ─────────────────────────────────
/** Total DC held across all members — the market supply S for the rate curve. */
function totalDcSupply(s: LedgerState): number {
  return round2(s.members.reduce((acc, m) => acc + Math.max(0, m.dcBalance), 0));
}

/** DC a member has already converted to CC during the given UTC day. */
function dcConvertedToday(s: LedgerState, email: string, nowMs: number): number {
  const today = dayKey(nowMs);
  let sum = 0;
  for (const t of s.transactions) {
    if (
      t.type === "CONVERT" &&
      t.currency === "DC" &&
      t.fromEmail === email &&
      dayKey(Date.parse(t.createdAt)) === today
    ) {
      sum += t.amountCC;
    }
  }
  return round2(sum);
}

/**
 * Pure DC->CC quote. CC = x * b(x) * m(S):
 *   b(x) = bulkMax - bulkSpread * e^(-x/bulkScale)               (bounded bulk bonus)
 *   m(S) = clamp((refSupply/S)^supplyGamma, clampMin, clampMax)  (scarcity = value)
 * Returns CC out, the effective per-DC rate, and the supply multiplier.
 */
export function quoteDcToCc(
  dcAmount: number,
  dcSupply: number,
): { cc: number; perDc: number; multiplier: number } {
  const c = config.dc;
  const x = Math.max(0, Number(dcAmount) || 0);
  const bulk = c.bulkMax - c.bulkSpread * Math.exp(-x / Math.max(1e-9, c.bulkScale));
  const S = Math.max(1, dcSupply); // guard div-by-zero; a near-empty market reads "scarce"
  const rawM = Math.pow(c.refSupply / S, c.supplyGamma);
  const m = Math.min(c.clampMax, Math.max(c.clampMin, rawM));
  const perDc = Math.max(0, bulk * m);
  return { cc: round2(x * perDc), perDc: round2(perDc), multiplier: round2(m) };
}

export type DcConvertStatus = {
  dcBalance: number;
  ccBalance: number;
  supply: number;
  minConvert: number;
  dailyCapDc: number;
  convertedToday: number;
  remainingToday: number;
};

export async function dcConvertStatus(email: string): Promise<DcConvertStatus> {
  const s = await ensureLoaded();
  const lower = email.trim().toLowerCase();
  const me = s.members.find((m) => m.email === lower);
  const convertedToday = dcConvertedToday(s, lower, Date.now());
  return {
    dcBalance: round2(me?.dcBalance ?? 0),
    ccBalance: round2(me?.balance ?? 0),
    supply: totalDcSupply(s),
    minConvert: config.dc.minConvert,
    dailyCapDc: config.dc.dailyCapDc,
    convertedToday,
    remainingToday: round2(Math.max(0, config.dc.dailyCapDc - convertedToday)),
  };
}

export type DcConvertResult = {
  dcSpent: number;
  ccReceived: number;
  perDc: number;
  multiplier: number;
  dcBalance: number;
  ccBalance: number;
  supply: number;
};

/**
 * Convert DC -> CC. Destroys the DC (a CONVERT/DC leg) and mints CC (a CONVERT/CC
 * leg); the destroyed DC reopens mining headroom (reserveRemaining counts it). DC
 * can never go negative. Allowed even while in credit-floor grace (it's a way back
 * to solvency), but blocked for a permanently-banned member.
 */
export async function convertDcToCc(
  actor: { email: string; name: string },
  dcAmount: number,
): Promise<DcConvertResult> {
  return mutate((draft) => {
    const me = ensureMemberDraft(draft, actor.email, actor.name);
    assertNotBanned(me);
    const x = round2(Number(dcAmount));
    if (!Number.isFinite(x) || x < config.dc.minConvert) {
      throw new LedgerError("INVALID", `Convert at least ${config.dc.minConvert} DC.`);
    }
    if (x > round2(me.dcBalance)) {
      throw new LedgerError("INSUFFICIENT_DC", `You only have ${round2(me.dcBalance)} DC.`);
    }
    const now = Date.now();
    const already = dcConvertedToday(draft, me.email, now);
    if (already + x > config.dc.dailyCapDc) {
      throw new LedgerError(
        "DAILY_CAP",
        `Daily conversion cap is ${config.dc.dailyCapDc} DC — you've already converted ${already} today.`,
      );
    }
    const supply = totalDcSupply(draft);
    const { cc, perDc, multiplier } = quoteDcToCc(x, supply);
    if (cc <= 0) {
      throw new LedgerError("INVALID", "That converts to 0 CC at the moment.");
    }

    me.dcBalance = round2(me.dcBalance - x); // x <= dcBalance, so never below 0
    me.balance = round2(me.balance + cc);
    refreshGrace(me, now); // converting to CC can lift you out of grace

    appendTransaction(draft, {
      type: "CONVERT",
      currency: "DC",
      fromEmail: me.email,
      toEmail: null,
      amountCC: x,
      offerId: null,
      memo: `Converted ${x} DC → ${cc} CC (${perDc}/DC · supply ×${multiplier})`,
    });
    appendTransaction(draft, {
      type: "CONVERT",
      currency: "CC",
      fromEmail: null,
      toEmail: me.email,
      amountCC: cc,
      offerId: null,
      memo: `+${cc} CC from converting ${x} DC`,
    });

    return {
      dcSpent: x,
      ccReceived: cc,
      perDc,
      multiplier,
      dcBalance: me.dcBalance,
      ccBalance: me.balance,
      supply: totalDcSupply(draft),
    };
  });
}

// ── Dark Capsule Coin: buy with real money (Fruit Fund) ─────────────────────
export type FruitFundStatus = {
  totalBdt: number;
  contributions: number;
  ministerEmail: string;
  ministerName: string;
};

export async function fruitFundStatus(): Promise<FruitFundStatus> {
  const s = await ensureLoaded();
  const ministerEmail = config.dc.fruitMinisterEmail;
  return {
    totalBdt: round2(s.fruitFundBdt ?? 0),
    contributions: s.transactions.filter((t) => t.type === "PURCHASE").length,
    ministerEmail,
    ministerName: allowlistEntry(ministerEmail)?.name || ministerEmail,
  };
}

export type DcBuyPricing = {
  bdtPerCC: number; // live CC market price (৳)
  perDcCc: number; // CC value of 1 DC at current scarcity (its best convert-back rate)
  bdtPerDc: number; // taka to buy 1 DC at today's market price
  multiplier: number; // scarcity multiplier m(S)
  supply: number; // total DC in circulation
  tiers: Array<{ bdt: number; dc: number }>; // how much DC common taka amounts buy
};

/**
 * Reference pricing for buying DC with real money, derived from the LIVE market:
 * 1 DC is worth its best convert-back rate (bulkMax · scarcity m(S)) in CC, and
 * 1 CC is worth today's ৳ rate — so ৳/DC = bulkMax · m(S) · bdtPerCC. Pricing DC
 * at its top convert rate keeps buying arbitrage-free (you can't buy DC then
 * convert it straight back for a profit). The Fruit Minister still records the
 * actual figures; this only powers the on-screen guide.
 */
export async function dcBuyPricing(): Promise<DcBuyPricing> {
  const s = await ensureLoaded();
  const v = valueReport(s, Date.now());
  const supply = totalDcSupply(s);
  const c = config.dc;
  const S = Math.max(1, supply); // near-empty market reads "scarce"
  const rawM = Math.pow(c.refSupply / S, c.supplyGamma);
  const m = Math.min(c.clampMax, Math.max(c.clampMin, rawM));
  const perDcCc = round2(c.bulkMax * m);
  const bdtPerDc = round2(perDcCc * v.bdtPerCC);
  const tiers = [100, 200, 500, 1000].map((bdt) => ({
    bdt,
    dc: bdtPerDc > 0 ? round2(bdt / bdtPerDc) : 0,
  }));
  return {
    bdtPerCC: v.bdtPerCC,
    perDcCc,
    bdtPerDc,
    multiplier: round2(m),
    supply: round2(supply),
    tiers,
  };
}

/** True for the one member allowed to record real-money DC purchases. */
export function isFruitMinister(email: string): boolean {
  return (
    email.trim().toLowerCase() ===
    config.dc.fruitMinisterEmail.trim().toLowerCase()
  );
}

export type BuyDcResult = {
  targetEmail: string;
  dcCredited: number;
  bdtPaid: number;
  dcBalance: number;
  fruitFundBdt: number;
};

/**
 * Record a DC purchase made with real money. The cash is handled offline; this
 * only credits the buyer's DC and tallies the proceeds into the Capsule Fruit
 * Fund. Restricted to the Fruit Minister (config.dc.fruitMinisterEmail).
 */
export async function buyDcWithMoney(
  actor: { email: string; name: string },
  input: { targetEmail: string; dcAmount: number; bdtPaid: number; note?: string },
): Promise<BuyDcResult> {
  if (!isFruitMinister(actor.email)) {
    throw new LedgerError(
      "NOT_ADMIN",
      "Only the Fruit Minister can record DC purchases.",
    );
  }
  const targetEmail = input.targetEmail.trim().toLowerCase();
  const dcAmount = round2(Number(input.dcAmount));
  const bdtPaid = round2(Number(input.bdtPaid));
  const note = (input.note || "").trim();
  return mutate((draft) => {
    if (!isAllowed(targetEmail)) {
      throw new LedgerError("NOT_MEMBER", "That buyer isn't a Capsule member.");
    }
    if (!Number.isFinite(dcAmount) || dcAmount <= 0) {
      throw new LedgerError("INVALID", "DC amount must be more than 0.");
    }
    if (!Number.isFinite(bdtPaid) || bdtPaid < 0) {
      throw new LedgerError("INVALID", "BDT paid can't be negative.");
    }
    const target = ensureMemberDraft(
      draft,
      targetEmail,
      allowlistEntry(targetEmail)?.name || targetEmail,
    );
    assertNotBanned(target); // a banned member can't receive DC either

    target.dcBalance = round2(target.dcBalance + dcAmount);
    draft.fruitFundBdt = round2((draft.fruitFundBdt ?? 0) + bdtPaid);

    appendTransaction(draft, {
      type: "PURCHASE",
      currency: "DC",
      fromEmail: null,
      toEmail: target.email,
      amountCC: dcAmount,
      offerId: null,
      memo: `Bought ${dcAmount} DC for ৳${bdtPaid} → Fruit Fund${note ? ` — ${note}` : ""}`,
    });

    return {
      targetEmail: target.email,
      dcCredited: dcAmount,
      bdtPaid,
      dcBalance: target.dcBalance,
      fruitFundBdt: draft.fruitFundBdt,
    };
  });
}

// ── Ledger export & global view (Phase 6) ───────────────────────────────────
export async function recentTransactions(limit = 100): Promise<Transaction[]> {
  const s = await ensureLoaded();
  return structuredClone(s.transactions)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, limit);
}

/** Build the current protected workbook and return it as a downloadable buffer. */
export async function exportWorkbookBuffer(): Promise<Buffer> {
  const s = await ensureLoaded();
  const wb = await buildWorkbook(s);
  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

// ── One-time opening-balance import (Phase 6 / launch) ───────────────────────
export async function importOpeningBalances(
  entries: Array<{ email: string; balance: number }>,
): Promise<{ imported: number; skipped: boolean }> {
  return mutate((draft) => {
    // Only ever seed a brand-new ledger — never touch a live one.
    if (draft.transactions.length > 0) return { imported: 0, skipped: true };

    let imported = 0;
    for (const e of entries) {
      const email = e.email.trim().toLowerCase();
      if (!isAllowed(email)) continue;
      const m = ensureMemberDraft(draft, email, allowlistEntry(email)?.name || email);
      const amt = Math.round(Number(e.balance) || 0);
      imported++;
      if (amt === 0) continue;
      m.balance = amt;
      appendTransaction(draft, {
        type: "ADJUST",
        fromEmail: amt < 0 ? email : null,
        toEmail: amt > 0 ? email : null,
        amountCC: Math.abs(amt),
        offerId: null,
        memo: "Opening balance (imported from manual ledger)",
      });
    }
    return { imported, skipped: false };
  });
}

/**
 * One-time launch import of the FULL transaction history. Every line is a real
 * trade, replayed chronologically as a TRANSFER stamped with its real time —
 * no opening-balance plugs, so the ledger is fully transparent (every entry is
 * an actual transaction). Only runs on a fresh ledger, or with { rebuild } to
 * wipe and re-import. Members are created un-verified (they "join" on first
 * sign-in).
 */
export async function importLedger(
  transactions: Array<{
    item: string;
    amount: number;
    sellerEmail: string; // receives CC
    buyerEmail: string; // pays CC
    date: string; // ISO timestamp of the trade
  }>,
  opts: { rebuild?: boolean } = {},
): Promise<{ imported: boolean; skipped: boolean; members: number; count: number }> {
  return mutate((draft) => {
    if (opts.rebuild) {
      // Full rebuild: wipe the ledger clean before re-importing from scratch.
      draft.transactions = [];
      draft.offers = [];
      draft.transfers = [];
      for (const m of draft.members) {
        m.balance = 0;
        m.lastMinedAt = null;
        m.mineDay = "";
        m.freeMinesUsed = 0;
        m.paidTier = 0;
        m.paidRemaining = 0;
      }
    } else if (draft.transactions.length > 0) {
      return { imported: false, skipped: true, members: 0, count: 0 };
    }

    // Ensure every allowlisted member exists (un-verified, balance 0).
    for (const entry of ALLOWLIST) {
      ensureMemberDraft(draft, entry.email, entry.name);
    }

    // Replay every trade chronologically as a real TRANSFER (buyer pays seller),
    // stamped with its real time. No opening-balance plugs.
    const sorted = [...transactions].sort(
      (a, b) => Date.parse(a.date) - Date.parse(b.date),
    );
    let count = 0;
    for (const t of sorted) {
      const s = t.sellerEmail.trim().toLowerCase();
      const b = t.buyerEmail.trim().toLowerCase();
      if (!isAllowed(s) || !isAllowed(b)) continue;
      const seller = ensureMemberDraft(draft, s, allowlistEntry(s)?.name || s);
      const buyer = ensureMemberDraft(draft, b, allowlistEntry(b)?.name || b);
      seller.balance = round2(seller.balance + t.amount);
      buyer.balance = round2(buyer.balance - t.amount);
      appendTransaction(draft, {
        type: "TRANSFER",
        fromEmail: buyer.email,
        toEmail: seller.email,
        amountCC: t.amount,
        offerId: null,
        memo: t.item,
        createdAt: new Date(t.date).toISOString(),
      });
      count++;
    }

    return { imported: true, skipped: false, members: draft.members.length, count };
  });
}

export function ledgerFilePath(): string {
  return "capsule-ledger.xlsx";
}
