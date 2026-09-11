import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { listTransactionsFor } from "@/lib/excel/store";
import { gateResponse } from "@/lib/http";
import type { TransactionPublic } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's own transaction history (audit hashes stay in the Excel ledger). */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  const txs = await listTransactionsFor(gate.identity.email);
  const transactions: TransactionPublic[] = txs.map((t) => ({
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
  return NextResponse.json({ transactions });
}
