import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import {
  listTransfers,
  createTransfer,
  expireStaleTransfers,
} from "@/lib/excel/store";
import type { TransferRequest } from "@/lib/excel/store";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";
import { config } from "@/lib/config";
import type { TransferRequestPublic, TransfersResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toPublic(t: TransferRequest, me: string): TransferRequestPublic {
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

/** Transfer requests, shaped for the viewer (pending is public to all members). */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);
  const me = gate.identity.email;

  // Silently drop pending requests that have sat past their TTL. Best-effort:
  // never let a cleanup failure break the read (it just retries next time).
  await expireStaleTransfers().catch(() => {});

  const all = (await listTransfers()).map((t) => toPublic(t, me));
  const byNewest = (a: TransferRequestPublic, b: TransferRequestPublic) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt);

  const pending = all.filter((t) => t.status === "PENDING").sort(byNewest);
  const incoming = pending.filter((t) => t.canApprove);
  const outgoing = pending.filter((t) => t.canCancel);
  const recent = all
    .filter((t) => t.status !== "PENDING")
    .sort((a, b) =>
      Date.parse(b.resolvedAt || b.createdAt) -
      Date.parse(a.resolvedAt || a.createdAt),
    )
    .slice(0, 30);

  const body: TransfersResponse = {
    incoming,
    outgoing,
    pending,
    recent,
    pendingForMe: incoming.length,
  };
  return NextResponse.json(body);
}

/** Create a transfer: { direction: "REQUEST"|"SEND", counterpartyEmail, amountCC, item, note? } */
export async function POST(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);
  const actor = { email: gate.identity.email, name: gate.identity.name };

  // Anti-bot: block bursts of transfer-request spam.
  const rl = rateLimit(
    `transfer:${actor.email}`,
    config.rateLimit.max,
    config.rateLimit.windowMs,
    config.rateLimit.blockMs,
  );
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: `Too many requests — slow down. Try again in ${
          rl.retryAfterMs >= 90000
            ? Math.ceil(rl.retryAfterMs / 60000) + " min"
            : Math.ceil(rl.retryAfterMs / 1000) + "s"
        }.`,
      },
      { status: 429 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const direction = body.direction === "SEND" ? "SEND" : "REQUEST";
    const result = await createTransfer(actor, {
      direction,
      counterpartyEmail: String(body.counterpartyEmail || ""),
      amountCC: Number(body.amountCC),
      item: String(body.item || ""),
      note: body.note ? String(body.note) : "",
    });
    return NextResponse.json(result);
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
