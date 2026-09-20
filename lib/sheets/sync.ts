import "server-only";

import { readFileSync } from "fs";
import path from "path";
import { google, sheets_v4 } from "googleapis";
import type { LedgerState } from "@/lib/excel/store";
import { valueReport } from "@/lib/value";

/**
 * Read-only Google Sheets mirror. The local Excel engine stays the source of
 * truth; after every committed change the server pushes the full state here so
 * members can view it (Viewer access) with an append-only, visible history.
 * Everything is best-effort and fully guarded — a Sheets failure never affects
 * a ledger write. Gated by GOOGLE_SHEETS_ID; a no-op when unset.
 */
const SHEET_ID = process.env.GOOGLE_SHEETS_ID?.trim() || "";

/** Format a UTC ISO timestamp as Bangladesh local time (UTC+6): "YYYY-MM-DD HH:MM". */
function bdt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 6 * 3600 * 1000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16).replace("T", " ");
}

type Creds = { client_email: string; private_key: string };

function loadCreds(): Creds | null {
  const file = process.env.FIREBASE_ADMIN_CREDENTIALS_FILE;
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  try {
    if (file && file.trim()) {
      const j = JSON.parse(
        readFileSync(path.resolve(process.cwd(), file.trim()), "utf8"),
      );
      if (j.client_email && j.private_key)
        return { client_email: j.client_email, private_key: j.private_key };
    }
    if (raw && raw.trim()) {
      const j = JSON.parse(raw);
      if (j.client_email && j.private_key)
        return { client_email: j.client_email, private_key: j.private_key };
    }
  } catch (e) {
    console.error("[sheets] could not load service-account creds:", e);
  }
  return null;
}

let client: sheets_v4.Sheets | null = null;
function getSheets(): sheets_v4.Sheets | null {
  if (client) return client;
  const creds = loadCreds();
  if (!creds) return null;
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  client = google.sheets({ version: "v4", auth });
  return client;
}

export function sheetsSyncEnabled(): boolean {
  return !!SHEET_ID;
}

async function ensureTabs(sheets: sheets_v4.Sheets, titles: string[]) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = new Set(
    (meta.data.sheets || []).map((s) => s.properties?.title),
  );
  const missing = titles.filter((t) => !existing.has(t));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }
}

type Cell = string | number | boolean | null;

// The four arcade games each get their own tab (like Mining), fed by the GAME
// reward txns that belong to them. A game is identified from the win memo (all
// wins share tx type GAME), so no ledger change is needed for this read-only view.
const GAME_TABS = [
  { title: "Guess the Word", match: "word game" },
  { title: "Type Racing", match: "type race" },
  { title: "Problem Solving", match: "Problem Solving" },
  { title: "AI Blitz", match: "AI Blitz" },
] as const;

/** Which game a GAME reward txn belongs to (by its memo), or null if unknown. */
function gameTabFor(memo: string): string | null {
  const m = memo || "";
  return GAME_TABS.find((g) => m.includes(g.match))?.title ?? null;
}

const TAB_ORDER = [
  "Value",
  "Members",
  "Mining",
  ...GAME_TABS.map((g) => g.title),
  "Transactions",
  "Requests",
];

/**
 * A1 range for a tab. Sheet names with spaces/punctuation must be single-quoted
 * in A1 notation (e.g. 'Guess the Word'!A1); single words are left bare.
 */
function tabRange(title: string, cell?: string): string {
  const name = /^[A-Za-z0-9]+$/.test(title) ? title : `'${title.replace(/'/g, "''")}'`;
  return cell ? `${name}!${cell}` : name;
}

/**
 * Put our data tabs first and remove the empty default "Sheet1", so anyone
 * opening the sheet lands on real data instead of a blank tab.
 */
async function organizeTabs(sheets: sheets_v4.Sheets) {
  // Cosmetic only — never let a reorder/delete hiccup fail the data sync.
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const props = (meta.data.sheets || [])
      .map((s) => s.properties)
      .filter((p): p is sheets_v4.Schema$SheetProperties => !!p);

    // Move our data tabs to the front.
    const reorder: sheets_v4.Schema$Request[] = [];
    TAB_ORDER.forEach((title, i) => {
      const p = props.find((x) => x.title === title);
      if (p && typeof p.sheetId === "number" && p.index !== i) {
        reorder.push({
          updateSheetProperties: {
            properties: { sheetId: p.sheetId, index: i },
            fields: "index",
          },
        });
      }
    });
    if (reorder.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { requests: reorder },
      });
    }

    // Best-effort: drop the empty default "Sheet1" (separate batch so a failure
    // here never undoes the reorder above).
    const sheet1 = props.find((x) => x.title === "Sheet1");
    if (sheet1 && typeof sheet1.sheetId === "number") {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { requests: [{ deleteSheet: { sheetId: sheet1.sheetId } }] },
      });
    }
  } catch (e) {
    console.error("[sheets] organizeTabs (non-fatal):", (e as Error).message || e);
  }
}

async function doSync(state: LedgerState): Promise<void> {
  const sheets = getSheets();
  if (!sheets) return;

  const now = Date.now();
  const v = valueReport(state, now);
  const nameOf = (email: string | null) => {
    if (!email) return "";
    const m = state.members.find((x) => x.email === email);
    return m ? m.name : email;
  };
  const circulating = state.members.reduce((s, m) => s + Math.max(0, m.balance), 0);
  const circulatingDc = state.members.reduce((s, m) => s + Math.max(0, m.dcBalance), 0);
  const standingOf = (m: LedgerState["members"][number]) =>
    m.banned ? "BANNED" : m.graceUntil ? "GRACE" : "OK";

  await ensureTabs(sheets, TAB_ORDER);
  await organizeTabs(sheets);

  const valueRows: Cell[][] = [
    ["Capsule Coin — live mirror", ""],
    ["Generated (UTC+6)", bdt(new Date(now).toISOString())],
    ["1 CC (BDT)", v.bdtPerCC],
    ["1 CC (USD)", v.usdPerCC],
    ["Balance spread (σ)", v.spread],
    ["Circulating supply (CC)", circulating],
    ["Circulating DC", circulatingDc],
    ["Transactions", state.transactions.length],
    ["Members joined", state.members.filter((m) => m.verified).length],
    [
      "Note",
      "Auto-synced by the Capsule Coin server after every change. Read-only mirror — the app is the source of truth.",
    ],
  ];

  const memberRows: Cell[][] = [
    ["Email", "Name", "Role", "Balance (CC)", "DC", "Joined", "Standing", "Last Mined (UTC+6)"],
    ...[...state.members]
      .sort((a, b) => b.balance - a.balance)
      .map((m): Cell[] => [
        m.email,
        m.name,
        m.role,
        m.balance,
        m.dcBalance,
        m.verified ? "yes" : "no",
        standingOf(m),
        bdt(m.lastMinedAt),
      ]),
  ];

  // Mining lives in its own tab now (DC rewards). MINE rows are excluded from
  // Transactions below and projected here instead.
  const mineRows: Cell[][] = [
    ["Seq", "Miner", "Amount", "Currency", "Memo", "Created (UTC+6)", "Hash"],
    ...state.transactions
      .filter((t) => t.type === "MINE")
      .map((t): Cell[] => [
        t.seq,
        nameOf(t.toEmail),
        t.amountCC,
        t.currency,
        t.memo,
        bdt(t.createdAt),
        t.hash,
      ]),
  ];

  // Each arcade game gets its own tab (like Mining): its GAME reward txns, routed
  // by memo. These are excluded from Transactions and projected here instead.
  const gameRows = (title: string): Cell[][] => [
    ["Seq", "Player", "Amount", "Currency", "Memo", "Created (UTC+6)", "Hash"],
    ...state.transactions
      .filter((t) => t.type === "GAME" && gameTabFor(t.memo) === title)
      .map((t): Cell[] => [
        t.seq,
        nameOf(t.toEmail),
        t.amountCC,
        t.currency,
        t.memo,
        bdt(t.createdAt),
        t.hash,
      ]),
  ];

  const txRows: Cell[][] = [
    ["Seq", "Type", "Currency", "From", "To", "Amount", "Memo", "Created (UTC+6)", "Hash"],
    ...state.transactions
      // MINE and each game's GAME wins live in their own tabs; keep an unclassified
      // GAME tx here (defensive) so nothing silently disappears from the mirror.
      .filter((t) => t.type !== "MINE" && !(t.type === "GAME" && gameTabFor(t.memo)))
      .map((t): Cell[] => [
        t.seq,
        t.type,
        t.currency,
        nameOf(t.fromEmail),
        nameOf(t.toEmail),
        t.amountCC,
        t.memo,
        bdt(t.createdAt),
        t.hash,
      ]),
  ];

  const reqRows: Cell[][] = [
    ["ID", "Payer", "Payee", "Amount (CC)", "Item", "Note", "Status", "Created (UTC+6)", "Resolved (UTC+6)"],
    ...state.transfers.map((r): Cell[] => [
      r.id,
      r.fromName,
      r.toName,
      r.amountCC,
      r.item,
      r.note,
      r.status,
      bdt(r.createdAt),
      bdt(r.resolvedAt),
    ]),
  ];

  // Batch every tab into TWO API calls (one clear + one write) instead of one
  // pair per tab. Same result, far fewer Sheets write requests per sync — more
  // headroom under the 60-writes/min quota. batchClear handles shrinking tabs so
  // no stale rows are left behind. (Tab names with spaces are quoted in A1.)
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: SHEET_ID,
    requestBody: { ranges: TAB_ORDER.map((t) => tabRange(t)) },
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: tabRange("Value", "A1"), values: valueRows },
        { range: tabRange("Members", "A1"), values: memberRows },
        { range: tabRange("Mining", "A1"), values: mineRows },
        ...GAME_TABS.map((g) => ({ range: tabRange(g.title, "A1"), values: gameRows(g.title) })),
        { range: tabRange("Transactions", "A1"), values: txRows },
        { range: tabRange("Requests", "A1"), values: reqRows },
      ],
    },
  });
}

// Coalescing scheduler: only one sync runs at a time; bursts collapse to the
// latest state, so we never pile up or clobber with stale data.
let running = false;
let pending: LedgerState | null = null;

export function scheduleSync(state: LedgerState): void {
  if (!SHEET_ID) return;
  pending = state;
  if (running) return;
  running = true;
  void (async () => {
    try {
      while (pending) {
        const snap = pending;
        pending = null;
        try {
          await doSync(snap);
        } catch (e) {
          console.error("[sheets] sync failed (non-fatal):", e);
        }
      }
    } finally {
      running = false;
    }
  })();
}

/** Awaitable single sync — used by the manual re-sync endpoint and tests. */
export async function syncNow(state: LedgerState): Promise<void> {
  if (!SHEET_ID) return;
  await doSync(state);
}
