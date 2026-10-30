import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { readState } from "@/lib/excel/store";
import { isAllowed, allowlistEntry } from "@/lib/allowlist";
import { round2 } from "@/lib/format";
import { gateResponse } from "@/lib/http";
import { pageMemberTx } from "@/lib/memberTx";

/** Rows per page in the profile transaction history (first page here; rest via the paging route). */
const TX_PAGE = 50;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A member's public profile: standing (balance/rank/share), lifetime stats, and
 * their transaction history. Any member may view any profile (balances are public).
 * `slug` is the email local-part (e.g. "riaz.khan") or a full email.
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
  const entry = allowlistEntry(email);
  const member = state.members.find((m) => m.email === email);
  const balance = member?.balance ?? 0;

  const rank =
    [...state.members].sort((a, b) => b.balance - a.balance).findIndex((m) => m.email === email) + 1;
  const positiveSupply = state.members.reduce((s, m) => s + Math.max(0, m.balance), 0);
  const sharePct =
    positiveSupply > 0 ? Number(((Math.max(0, balance) / positiveSupply) * 100).toFixed(1)) : 0;

  const mine = state.transactions.filter(
    (t) => t.fromEmail === email || t.toEmail === email,
  );

  let received = 0, sent = 0, tradeCount = 0, timesMined = 0, totalMined = 0, totalBurned = 0;
  for (const t of mine) {
    if (t.type === "MINE") {
      timesMined++;
      totalMined += t.amountCC;
    } else if (t.type === "BURN") {
      totalBurned += t.amountCC;
    } else if (t.type === "TRANSFER" || t.type === "TRADE") {
      tradeCount++;
      if (t.toEmail === email) received += t.amountCC;
      else sent += t.amountCC;
    }
  }

  // First page of the transaction history; older pages load via
  // GET /api/members/[slug]/transactions?offset=…&limit=…
  const nameByEmail = new Map(state.members.map((m) => [m.email, m.name]));
  const txPage = pageMemberTx(state.transactions, email, 0, TX_PAGE, nameByEmail);

  return NextResponse.json({
    email,
    name: entry?.name || email,
    role: entry?.role || "Member",
    balance: round2(balance),
    dcBalance: round2(member?.dcBalance ?? 0),
    joined: member?.verified ?? false,
    isYou: email === gate.identity.email,
    rank,
    memberCount: state.members.length,
    sharePct,
    stats: {
      received: round2(received),
      sent: round2(sent),
      tradeCount,
      timesMined,
      totalMined: round2(totalMined),
      totalBurned: round2(totalBurned),
    },
    transactions: txPage.transactions,
    txTotal: txPage.total,
    txHasMore: txPage.hasMore,
  });
}
