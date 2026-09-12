import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import {
  convertDcToCc,
  dcConvertStatus,
  quoteDcToCc,
} from "@/lib/excel/store";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/convert?dc=10
 * Current DC market supply, the caller's DC/CC balances, today's remaining
 * conversion allowance, and a live quote for `dc` (0 when omitted). Drives the
 * conversion UI's rate preview.
 */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  const status = await dcConvertStatus(gate.identity.email);
  const dc = Number(new URL(req.url).searchParams.get("dc") || "0");
  const quote = quoteDcToCc(
    Number.isFinite(dc) ? dc : 0,
    status.supply,
    status.bdtPerCC,
  );
  return NextResponse.json({ ...status, quote });
}

/** POST /api/convert { dcAmount } — execute a DC->CC conversion for the caller. */
export async function POST(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  let dcAmount = NaN;
  try {
    const body = await req.json();
    dcAmount = Number(body?.dcAmount);
  } catch {
    /* fall through to the validation error below */
  }

  try {
    const result = await convertDcToCc(gate.identity, dcAmount);
    return NextResponse.json(result);
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
