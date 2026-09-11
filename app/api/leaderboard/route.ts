import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { ALLOWLIST, normalizeEmail } from "@/lib/allowlist";
import { listMembers } from "@/lib/excel/store";
import type { LeaderboardRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public (to members) leaderboard. Every allowlisted member appears — those who
 * haven't signed in yet show as not-joined with a 0 balance — so the overview is
 * complete from day one. Requires a verified member (internal-only).
 */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "unauthenticated" : "notMember" },
      { status: gate.status },
    );
  }

  const members = await listMembers();
  const byEmail = new Map(members.map((m) => [m.email, m]));
  const you = normalizeEmail(gate.identity.email);

  const merged = ALLOWLIST.map((a) => {
    const email = normalizeEmail(a.email);
    const m = byEmail.get(email);
    return {
      name: a.name,
      email,
      balance: m?.balance ?? 0,
      role: m?.role ?? a.role,
      // "Joined" = has verified their email and actually entered the app,
      // not merely having a seeded balance row.
      joined: Boolean(m?.verified),
    };
  });
  const joinedCount = merged.filter((x) => x.joined).length;

  // "Supply" = CC actually held: the sum of positive balances. Negative
  // balances are credit lines (borrowed against the −500 floor), not circulating
  // coin, so they don't cancel out the supply or earn a share.
  const totalSupply = merged.reduce((s, x) => s + Math.max(0, x.balance), 0);
  merged.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));

  const rows: LeaderboardRow[] = [];
  let lastBalance: number | null = null;
  let lastRank = 0;
  merged.forEach((x, i) => {
    const rank = lastBalance !== null && x.balance === lastBalance ? lastRank : i + 1;
    lastBalance = x.balance;
    lastRank = rank;
    rows.push({
      rank,
      name: x.name,
      email: x.email,
      balance: x.balance,
      role: x.role,
      joined: x.joined,
      isYou: x.email === you,
      sharePct:
        totalSupply > 0
          ? Number(((Math.max(0, x.balance) / totalSupply) * 100).toFixed(1))
          : 0,
    });
  });

  return NextResponse.json({
    totalSupply,
    memberCount: ALLOWLIST.length,
    joinedCount,
    rows,
  });
}
