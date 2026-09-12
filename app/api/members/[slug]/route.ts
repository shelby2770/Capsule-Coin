import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { readState } from "@/lib/excel/store";
import { isAllowed, allowlistEntry } from "@/lib/allowlist";
import { round2 } from "@/lib/format";
import { gateResponse } from "@/lib/http";

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

  const nameOf = (e: string | null) => (e ? allowlistEntry(e)?.name || e : "");
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

  const transactions = [...mine]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 50)
    .map((t) => {
      let direction: "in" | "out" | "mine" | "burn" | "adjust" = "adjust";
      let counterpartyName = "";
      if (t.type === "MINE") direction = "mine";
      else if (t.type === "BURN") direction = "burn";
      else if (t.type === "ADJUST") direction = "adjust";
      else if (t.toEmail === email) {
        direction = "in";
        counterpartyName = nameOf(t.fromEmail);
      } else {
        direction = "out";
        counterpartyName = nameOf(t.toEmail);
      }
      return {
        seq: t.seq,
        type: t.type,
        direction,
        counterpartyName,
        amountCC: t.amountCC,
        currency: t.currency,
        memo: t.memo,
        createdAt: t.createdAt,
      };
    });

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
    transactions,
  });
}
