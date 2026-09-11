import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { readState } from "@/lib/excel/store";
import { valueHistory, firstTxTime } from "@/lib/value";
import { gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/** ৳/CC value series over a time range (24h | 7d | all), for the history chart. */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  const state = await readState();
  const now = Date.now();
  const range = new URL(req.url).searchParams.get("range") || "7d";

  let from: number;
  if (range === "24h") from = now - DAY;
  else if (range === "all") from = firstTxTime(state) ?? now - DAY;
  else from = now - 7 * DAY; // default: 7d

  // Guard a degenerate span (brand-new ledger) so the chart isn't a single point.
  if (now - from < 3_600_000) from = now - 3_600_000;

  const points = range === "24h" ? 48 : 60;
  const series = valueHistory(state, now, from, points);
  return NextResponse.json({ range, from, now, series });
}
