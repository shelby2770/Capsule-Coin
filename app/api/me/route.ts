import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { getOrCreateMember } from "@/lib/excel/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the signed-in member, creating their wallet on first verified sign-in.
 * 401 = not signed in / bad token. 403 = signed in but not on the allowlist.
 */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) {
    if (gate.status === 401) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return NextResponse.json({ status: "notMember" }, { status: 403 });
  }

  const m = await getOrCreateMember(gate.identity.email, gate.identity.name);
  return NextResponse.json({
    status: "member",
    member: {
      email: m.email,
      name: m.name,
      balance: m.balance,
      dcBalance: m.dcBalance,
      role: m.role,
      verified: m.verified,
      lastMinedAt: m.lastMinedAt,
      createdAt: m.createdAt,
      graceUntil: m.graceUntil,
      banned: m.banned,
      onboardedAt: m.onboardedAt,
      arcadeOnboardedAt: m.arcadeOnboardedAt,
      dcSplitSeenAt: m.dcSplitSeenAt,
    },
  });
}
