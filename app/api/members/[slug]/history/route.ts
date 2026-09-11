import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { readState } from "@/lib/excel/store";
import { balanceHistoryFor, firstTxTime } from "@/lib/value";
import { isAllowed } from "@/lib/allowlist";
import { gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * A member's CC balance series over a range (7d | 30d | all), for the balance
 * history chart on the profile and dashboard. Balances are public to members.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  const { slug } = await params;
  const raw = decodeURIComponent(slug).trim().toLowerCase();
  const email = raw.includes("@") ? raw : `${raw}@orbitax.com`;
  if (!isAllowed(email)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const state = await readState();
  const now = Date.now();
  const range = new URL(req.url).searchParams.get("range") || "30d";

  let from: number;
  if (range === "7d") from = now - 7 * DAY;
  else if (range === "all") from = firstTxTime(state) ?? now - 7 * DAY;
  else from = now - 30 * DAY; // default: 30d

  // Guard a degenerate span (brand-new ledger) so the chart isn't a single point.
  if (now - from < 3_600_000) from = now - 3_600_000;

  const series = balanceHistoryFor(state, email, now, from, 60);
  return NextResponse.json({ range, from, now, series });
}
