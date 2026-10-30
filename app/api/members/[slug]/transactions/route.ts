import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { readState } from "@/lib/excel/store";
import { isAllowed } from "@/lib/allowlist";
import { gateResponse } from "@/lib/http";
import { pageMemberTx } from "@/lib/memberTx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * A page of a member's transaction history (newest first), for the profile's
 * "Load more" control. `?offset` rows in, up to `?limit` (max 200). Returns the
 * same row shape as the profile's first page plus { total, offset, limit, hasMore }.
 * Balances/history are public to members.
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

  const url = new URL(req.url);
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
  const rawLimit = Math.floor(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT);
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));

  const state = await readState();
  const nameByEmail = new Map(state.members.map((m) => [m.email, m.name]));
  return NextResponse.json(pageMemberTx(state.transactions, email, offset, limit, nameByEmail));
}
