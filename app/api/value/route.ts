import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { readState } from "@/lib/excel/store";
import { valueReport } from "@/lib/value";
import { gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The live Scarcity/Demand index + 24h trend. */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);
  const state = await readState();
  return NextResponse.json(valueReport(state, Date.now()));
}
