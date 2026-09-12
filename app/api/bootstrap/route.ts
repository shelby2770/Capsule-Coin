import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { readState, expireStaleTransfers } from "@/lib/excel/store";
import type { Transaction, TransferRequest, Member } from "@/lib/excel/store";
import { valueReport } from "@/lib/value";
import { ALLOWLIST, normalizeEmail } from "@/lib/allowlist";
import { gateResponse } from "@/lib/http";
import type {
  LeaderboardRow,
  LeaderboardResponse,
  TransfersResponse,
  TransferRequestPublic,
  TransactionPublic,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Consolidated first-load payload. A single member gate + one ledger read powers
 * the leaderboard, value, transfers, and the caller's transactions together —
 * so the shell/wallet load in ONE request instead of ~6 (each of which was its
 * own serverless invocation + ledger read). The individual endpoints stay for
 * anything that needs them standalone.
 */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);
  const me = normalizeEmail(gate.identity.email);

  // Same lazy cleanup the transfers route does; best-effort.
  await expireStaleTransfers().catch(() => {});
  const state = await readState();
  const now = Date.now();

  return NextResponse.json({
    leaderboard: buildLeaderboard(state.members, me),
    value: valueReport(state, now),
    transfers: shapeTransfers(state.transfers, me),
    transactions: myTransactions(state.transactions, me),
  });
}

// ── mirrors app/api/leaderboard/route.ts ────────────────────────────────────
function buildLeaderboard(members: Member[], you: string): LeaderboardResponse {
  const byEmail = new Map(members.map((m) => [m.email, m]));
  const merged = ALLOWLIST.map((a) => {
    const email = normalizeEmail(a.email);
    const m = byEmail.get(email);
    return {
      name: a.name,
      email,
      balance: m?.balance ?? 0,
      dcBalance: m?.dcBalance ?? 0,
      banned: Boolean(m?.banned),
      role: m?.role ?? a.role,
      joined: Boolean(m?.verified),
    };
  });
  const joinedCount = merged.filter((x) => x.joined).length;
  const totalSupply = merged.reduce((s, x) => s + Math.max(0, x.balance), 0);
  const totalDc = merged.reduce((s, x) => s + Math.max(0, x.dcBalance), 0);
  merged.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));

  const rows: LeaderboardRow[] = [];
  let lastBalance: number | null = null;
  let lastRank = 0;
  merged.forEach((x, i) => {
    const rank = lastBalance !== null && x.balance === lastBalance ? lastRank : i + 1;
    lastBalance = x.balance;
    lastRank = rank;
    rows.push({
      rank,
      name: x.name,
      email: x.email,
      balance: x.balance,
      dcBalance: x.dcBalance,
      banned: x.banned,
      role: x.role,
      joined: x.joined,
      isYou: x.email === you,
      sharePct:
        totalSupply > 0
          ? Number(((Math.max(0, x.balance) / totalSupply) * 100).toFixed(1))
          : 0,
    });
  });
  return { totalSupply, totalDc, memberCount: ALLOWLIST.length, joinedCount, rows };
}

// ── mirrors app/api/transfers/route.ts ──────────────────────────────────────
function transferToPublic(t: TransferRequest, me: string): TransferRequestPublic {
  const role: TransferRequestPublic["role"] =
    t.fromEmail === me ? "payer" : t.toEmail === me ? "payee" : "other";
  const initiatorEmail = t.initiatedBy === "PAYER" ? t.fromEmail : t.toEmail;
  return {
    id: t.id,
    fromEmail: t.fromEmail,
    fromName: t.fromName,
    toEmail: t.toEmail,
    toName: t.toName,
    amountCC: t.amountCC,
    item: t.item,
    note: t.note,
    initiatedBy: t.initiatedBy,
    status: t.status,
    createdAt: t.createdAt,
    resolvedAt: t.resolvedAt,
    role,
    canApprove: t.status === "PENDING" && t.fromEmail === me,
    canCancel: t.status === "PENDING" && initiatorEmail === me,
  };
}

function shapeTransfers(transfers: TransferRequest[], me: string): TransfersResponse {
  const all = transfers.map((t) => transferToPublic(t, me));
  const byNewest = (a: TransferRequestPublic, b: TransferRequestPublic) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt);
  const pending = all.filter((t) => t.status === "PENDING").sort(byNewest);
  const incoming = pending.filter((t) => t.canApprove);
  const outgoing = pending.filter((t) => t.canCancel);
  const recent = all
    .filter((t) => t.status !== "PENDING")
    .sort(
      (a, b) =>
        Date.parse(b.resolvedAt || b.createdAt) -
        Date.parse(a.resolvedAt || a.createdAt),
    )
    .slice(0, 30);
  return { incoming, outgoing, pending, recent, pendingForMe: incoming.length };
}

// ── mirrors app/api/transactions/route.ts (the caller's own history) ─────────
function myTransactions(transactions: Transaction[], me: string): TransactionPublic[] {
  return transactions
    .filter((t) => t.fromEmail === me || t.toEmail === me)
    .sort((a, b) => b.seq - a.seq)
    .map((t) => ({
      seq: t.seq,
      id: t.id,
      type: t.type,
      currency: t.currency,
      fromEmail: t.fromEmail,
      toEmail: t.toEmail,
      amountCC: t.amountCC,
      offerId: t.offerId,
      memo: t.memo,
      createdAt: t.createdAt,
    }));
}
