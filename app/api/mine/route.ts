import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { mine, mineStatus, buyMiningPack } from "@/lib/excel/store";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mining status: free/paid attempts left, next pack, reserve headroom, cap. */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);
  return NextResponse.json(await mineStatus(gate.identity.email));
}

/**
 * POST { action: "mine" } — run a collision-lottery mine (free, else paid).
 * POST { action: "buy" }  — burn the next pay-to-mine pack's fee to unlock it.
 * Defaults to "mine" when no body is sent.
 */
export async function POST(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  let action = "mine";
  try {
    const body = await req.json();
    if (body && typeof body.action === "string") action = body.action;
  } catch {
    /* no body -> default to mine */
  }

  const actor = { email: gate.identity.email, name: gate.identity.name };
  try {
    if (action === "buy") {
      return NextResponse.json(await buyMiningPack(actor));
    }
    return NextResponse.json(await mine(actor));
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
