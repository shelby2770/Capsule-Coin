"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { BalanceHistoryCard } from "@/components/BalanceHistoryCard";
import { useAuth } from "@/components/AuthProvider";
import { useValue } from "@/lib/useValue";
import { formatCC, formatDC, formatBdt, balanceStanding } from "@/lib/format";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { LEDGER_EVENT } from "@/lib/ledgerEvents";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Pickaxe,
  Flame,
  Loader2,
  Trophy,
  Wallet,
  ArrowLeftRight,
  AlertTriangle,
  PieChart,
  Sparkles,
  Banknote,
  ChevronDown,
} from "lucide-react";

type Tx = {
  seq: number;
  type: string;
  direction: "in" | "out" | "mine" | "burn" | "adjust";
  counterpartyName: string;
  amountCC: number;
  currency?: "CC" | "DC";
  memo: string;
  createdAt: string;
};
type Profile = {
  email: string;
  name: string;
  role: string;
  balance: number;
  dcBalance: number;
  joined: boolean;
  isYou: boolean;
  rank: number;
  memberCount: number;
  sharePct: number;
  stats: {
    received: number;
    sent: number;
    tradeCount: number;
    timesMined: number;
    totalMined: number;
    totalBurned: number;
  };
  transactions: Tx[];
  txTotal: number;
  txHasMore: boolean;
};

type TxPage = {
  transactions: Tx[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

type Icon = React.ComponentType<{ size?: number; className?: string }>;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}
function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function MemberPage() {
  return (
    <AppShell>
      <MemberProfile />
    </AppShell>
  );
}

function BackLink() {
  return (
    <Link
      href="/leaderboard"
      className="inline-flex items-center gap-1.5 text-sm text-mute transition hover:text-white"
    >
      <ArrowLeft size={15} /> Back to leaderboard
    </Link>
  );
}

function StatCard({
  icon: I,
  iconNode,
  label,
  value,
  tone,
  iconTone,
}: {
  icon?: Icon;
  iconNode?: React.ReactNode;
  label: string;
  value: string;
  tone?: string;
  iconTone?: string;
}) {
  return (
    <div className="capsule-card p-4">
      <div className="flex items-center gap-2 text-xs text-mute">
        {iconNode ?? (I && <I size={14} className={iconTone ?? "text-gold-400"} />)} {label}
      </div>
      <div className={`mt-1 text-xl font-bold ${tone ?? "text-white"}`}>{value}</div>
    </div>
  );
}

function describe(t: Tx): { Icon: Icon; tone: string; amtTone: string; sign: string; text: string } {
  const memo = t.memo ? ` · ${t.memo}` : "";
  // Real-money DC purchase: the memo already reads "Bought N DC for ৳X → …".
  if (t.type === "PURCHASE") {
    return { Icon: Banknote, tone: "text-flame", amtTone: "text-flame", sign: "+", text: t.memo || "Bought DC" };
  }
  switch (t.direction) {
    case "in":
      return { Icon: ArrowDownLeft, tone: "text-teal-300", amtTone: "text-teal-300", sign: "+", text: `Received from ${t.counterpartyName}${memo}` };
    case "out":
      return { Icon: ArrowUpRight, tone: "text-red-300", amtTone: "text-red-300", sign: "−", text: `Sent to ${t.counterpartyName}${memo}` };
    case "mine":
      return { Icon: Pickaxe, tone: "text-flame", amtTone: "text-flame", sign: "+", text: `Mined${memo}` };
    case "burn":
      return { Icon: Flame, tone: "text-orange-300", amtTone: "text-orange-300", sign: "−", text: "Burned to unlock mining" };
    default:
      return { Icon: Sparkles, tone: "text-mute", amtTone: "text-white", sign: "", text: t.memo || "Opening balance" };
  }
}

function MemberProfile() {
  const { slug } = useParams<{ slug: string }>();
  const { authedFetch, status } = useAuth();
  const { data: value } = useValue();
  const [p, setP] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (status !== "member" || !slug) return;
    const load = () =>
      authedFetch(`/api/members/${slug}`)
        .then(async (r) => {
          if (r.status === 404) { setMissing(true); return; }
          if (r.ok) {
            const prof = (await r.json()) as Profile;
            setP(prof);
            // Reset the paged list to the fresh first page (also on ledger updates).
            setTxs(prof.transactions);
            setTxTotal(prof.txTotal);
            setHasMore(prof.txHasMore);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    void load();
    window.addEventListener(LEDGER_EVENT, load);
    return () => window.removeEventListener(LEDGER_EVENT, load);
  }, [status, slug, authedFetch]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const r = await authedFetch(
        `/api/members/${slug}/transactions?offset=${txs.length}&limit=50`,
      );
      if (r.ok) {
        const page = (await r.json()) as TxPage;
        setTxs((cur) => {
          const seen = new Set(cur.map((t) => t.seq));
          return [...cur, ...page.transactions.filter((t) => !seen.has(t.seq))];
        });
        setHasMore(page.hasMore);
        setTxTotal(page.total);
      }
    } catch {
      /* leave the list as-is on a failed page fetch */
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading && !p) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-mute">
        <Loader2 size={20} className="animate-spin text-gold-400" /> Loading profile…
      </div>
    );
  }
  if (missing || !p) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="capsule-card p-8 text-center text-mute">That member doesn&apos;t exist.</div>
      </div>
    );
  }

  const negative = p.balance < 0;
  const standing = balanceStanding(p.balance); // `banned` isn't exposed on the public profile
  const bdt = value ? Math.abs(p.balance) * value.bdtPerCC : null;

  return (
    <div className="space-y-4">
      <BackLink />

      <div className="capsule-card p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-capsule bg-gold-500/15 text-lg font-bold text-gold-300">
            {initials(p.name)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-xl font-bold text-white">{p.name}</h1>
              {p.isYou && (
                <span className="chip border-gold-500/40 py-0.5 text-[11px] text-gold-300">you</span>
              )}
              {!p.joined && <span className="text-[11px] text-mute/70">not joined yet</span>}
              {standing === "bankrupt" && (
                <span className="chip border-red-500/40 py-0.5 text-[11px] font-medium text-red-300">
                  <AlertTriangle size={11} /> bankrupt
                </span>
              )}
              {standing === "warn" && (
                <span className="chip border-amber-500/40 py-0.5 text-[11px] text-amber-300">
                  <AlertTriangle size={11} /> near bankrupt
                </span>
              )}
            </div>
            <div className="text-sm text-teal-300/80">{p.role}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={Wallet} label="CC balance" value={`${formatCC(p.balance)} CC`} tone={negative ? "text-red-300" : "text-gold-300"} />
        <StatCard iconNode={<DarkCoinLogo size={14} />} label="DC balance" value={`${formatDC(p.dcBalance)} DC`} tone="text-flame" />
        <StatCard icon={Trophy} label="Rank" value={`#${p.rank} of ${p.memberCount}`} />
        <StatCard
          icon={PieChart}
          label={negative ? "Toward −500 floor" : "Share of supply"}
          value={negative ? `${Math.round((Math.abs(p.balance) / 500) * 100)}%` : `${p.sharePct}%`}
          tone={negative ? "text-red-300" : undefined}
        />
      </div>
      {bdt != null && (
        <div className="text-xs text-mute">
          ≈ ৳{formatBdt(bdt)} at today&apos;s rate{negative ? " (debt)" : ""}.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={ArrowDownLeft} label="Received" value={`${formatCC(p.stats.received)} CC`} tone="text-teal-300" />
        <StatCard icon={ArrowUpRight} label="Sent" value={`${formatCC(p.stats.sent)} CC`} />
        <StatCard icon={ArrowLeftRight} label="Trades" value={`${p.stats.tradeCount}`} />
        <StatCard icon={Pickaxe} iconTone="text-flame" label={`Mined (${p.stats.timesMined}×)`} value={`${formatDC(p.stats.totalMined)} DC`} tone="text-flame" />
      </div>

      <BalanceHistoryCard slug={slug} />

      <section className="capsule-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-white/5 px-4 py-3 sm:px-6">
          <span className="text-sm font-semibold text-white">Transaction history</span>
          {txTotal > 0 && (
            <span className="text-[11px] text-mute">
              {txs.length} of {txTotal}
            </span>
          )}
        </div>
        {txs.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-mute sm:px-6">No transactions yet.</div>
        ) : (
          <>
            <ul className="divide-y divide-white/5">
              {txs.map((t) => {
                const d = describe(t);
                const cur = t.currency ?? "CC";
                const fmt = cur === "DC" ? formatDC : formatCC;
                return (
                  <li key={t.seq} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                    <d.Icon size={16} className={`shrink-0 ${d.tone}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-white/90">{d.text}</div>
                      <div className="text-[11px] text-mute">{timeAgo(t.createdAt)}</div>
                    </div>
                    <div className={`shrink-0 text-sm font-semibold ${d.amtTone}`}>
                      {d.sign}
                      {fmt(t.amountCC)} <span className="text-xs text-mute">{cur}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <div className="border-t border-white/5 px-4 py-3 text-center sm:px-6">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-1.5 text-sm text-teal-300 transition hover:text-teal-200 disabled:opacity-60"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Loading…
                    </>
                  ) : (
                    <>
                      <ChevronDown size={15} /> Load more ({txTotal - txs.length} older)
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
