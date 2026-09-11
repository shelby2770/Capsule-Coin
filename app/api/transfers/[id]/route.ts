import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import {
  approveTransfer,
  declineTransfer,
  cancelTransfer,
} from "@/lib/excel/store";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Act on a pending transfer: { action: "approve" | "decline" | "cancel" }. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);
  const { id } = await params;
  const email = gate.identity.email;

  let action = "";
  try {
    const body = await req.json();
    action = typeof body?.action === "string" ? body.action : "";
  } catch {
    /* no body */
  }

  try {
    if (action === "approve")
      return NextResponse.json(await approveTransfer(email, id));
    if (action === "decline")
      return NextResponse.json(await declineTransfer(email, id));
    if (action === "cancel")
      return NextResponse.json(await cancelTransfer(email, id));
    return NextResponse.json(
      { error: "INVALID", message: "Unknown action." },
      { status: 400 },
    );
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
