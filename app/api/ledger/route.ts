import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { readState } from "@/lib/excel/store";
import { allowlistEntry } from "@/lib/allowlist";
import { gateResponse } from "@/lib/http";
import type { LedgerTx } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Global, read-only ledger view (member-gated): recent transactions + totals. */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  const state = await readState();
  const nameOf = (email: string | null) =>
    email ? allowlistEntry(email)?.name || email : null;

  const recent = [...state.transactions].sort((a, b) => b.seq - a.seq).slice(0, 100);
  const transactions: LedgerTx[] = recent.map((t) => ({
    seq: t.seq,
    type: t.type,
    fromName: nameOf(t.fromEmail),
    toName: nameOf(t.toEmail),
    amountCC: t.amountCC,
    memo: t.memo,
    createdAt: t.createdAt,
  }));
  const totalVolume = state.transactions
    .filter((t) => t.type === "TRADE" || t.type === "TRANSFER")
    .reduce((s, t) => s + t.amountCC, 0);

  return NextResponse.json({
    transactions,
    txCount: state.transactions.length,
    totalVolume,
    memberCount: state.members.length,
  });
}
