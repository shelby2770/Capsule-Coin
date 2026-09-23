import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth/verify";
import {
  dcConvertStatus,
  quoteDcToCc,
  markDcSplitChoice,
  getMember,
} from "@/lib/excel/store";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — the one-time DC/CC split migration status for the caller: their full DC
 * balance and what converting ALL of it would yield right now, plus whether they've
 * already chosen. Drives the migration story's final choice step.
 */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  const status = await dcConvertStatus(gate.identity.email);
  const me = await getMember(gate.identity.email);
  const quote = quoteDcToCc(status.dcBalance, status.supply);
  return NextResponse.json({
    dcBalance: status.dcBalance,
    ccBalance: status.ccBalance,
    ccQuote: quote.cc,
    perDc: quote.perDc,
    minConvert: status.minConvert,
    alreadyChosen: !!me?.dcSplitSeenAt,
  });
}

const Body = z.object({ choice: z.enum(["convert", "keep"]) });

/** POST { choice } — record the member's one-time convert-or-keep decision. */
export async function POST(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  let choice: "convert" | "keep";
  try {
    choice = Body.parse(await req.json()).choice;
  } catch {
    return NextResponse.json(
      { error: "INVALID", message: "Pick convert or keep." },
      { status: 400 },
    );
  }
  try {
    const result = await markDcSplitChoice(gate.identity.email, choice);
    return NextResponse.json(result);
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
