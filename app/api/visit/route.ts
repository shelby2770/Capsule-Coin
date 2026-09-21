import { NextResponse } from "next/server";
import { verifyBearer } from "@/lib/auth/verify";
import { isOrbitaxEmail } from "@/lib/domain";
import { publicOverview } from "@/lib/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/visit — read-only economy overview for the guest tour.
 *
 * Open to ANY authenticated @orbitax.com account (members included); it is NOT
 * gated on the member allowlist, since the whole point is to let non-member
 * colleagues look around. Returns only aggregates (see publicOverview) — never
 * per-member data — so exposing it to non-members leaks nothing personal.
 */
export async function GET(req: Request) {
  const identity = await verifyBearer(req);
  if (!identity) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!isOrbitaxEmail(identity.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(await publicOverview());
}
