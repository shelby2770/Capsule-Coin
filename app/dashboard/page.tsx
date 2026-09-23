"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { BalanceHistoryCard } from "@/components/BalanceHistoryCard";
import { useAuth } from "@/components/AuthProvider";
import { useLeaderboard } from "@/lib/useLeaderboard";
import { useTransactions } from "@/lib/useTransactions";
import { useValue } from "@/lib/useValue";
import { CountUp } from "@/components/CountUp";
import { formatCC, formatDC, formatBdt, BALANCE_WARN } from "@/lib/format";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { CoinLogo } from "@/components/CoinLogo";
import { Sparkline } from "@/components/Sparkline";
import type { TransactionPublic, ValueResponse } from "@/lib/types";
import {
  Wallet,
  Trophy,
  Layers,
  TrendingUp,
  TrendingDown,
  Gauge,
  ArrowRight,
  ChevronRight,
  Crown,
  History,
  Pickaxe,
  ArrowLeftRight,
  Lock,
  RotateCcw,
  Sparkles,
  Flame,
  Repeat,
  Banknote,
  AlertTriangle,
  Gamepad2,
} from "lucide-react";

export default function DashboardPage() {
  return (
    <AppShell>
      <WalletHome />
    </AppShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="capsule-card p-5">
      <div className="flex items-center gap-2 text-sm text-mute">
        <Icon size={16} className="text-teal-400" /> {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

function ChangeBadge({ ch }: { ch: number | null }) {
  const up = ch !== null && ch > 0;
  const down = ch !== null && ch < 0;
  const color = up ? "text-teal-300" : down ? "text-red-300" : "text-mute";
  const Icon = up ? TrendingUp : down ? TrendingDown : null;
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${color}`}>
      {Icon && <Icon size={14} />}
      {ch === null ? "new" : `${ch > 0 ? "+" : ""}${ch}%`}
    </span>
  );
}

function ValueCard({ data }: { data: ValueResponse | null }) {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-gold-500/25 bg-gradient-to-br from-gold-500/[0.12] via-ink-700/70 to-ink-700/70 p-6 shadow-glow">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gold-300/90">
            <Gauge size={15} /> Live CC value
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-4xl font-bold tabular-nums text-gold-300">
              ৳{data ? formatBdt(data.bdtPerCC) : "—"}
            </span>
            <span className="text-xl font-semibold tabular-nums text-white">
              ${data ? data.usdPerCC.toFixed(4) : "—"}
            </span>
            {data && <ChangeBadge ch={data.change24h} />}
          </div>
          <div className="mt-1.5 truncate text-xs text-mute">
            per CC · balance spread σ{data ? data.spread.toLocaleString() : "—"} ·
            scarcity index {data ? data.index.toFixed(2) : "—"}
          </div>
        </div>
        <Link
          href="/value"
          className="group flex shrink-0 flex-col items-end gap-1"
          title="Open the value history chart"
        >
          <Sparkline series={data?.series ?? []} width={160} height={56} id="dash-spark" />
          <span className="text-xs text-gold-300/80 transition group-hover:text-gold-300">
            View history →
          </span>
        </Link>
      </div>
    </section>
  );
}

const TX_ICON: Record<
  TransactionPublic["type"],
  React.ComponentType<{ size?: number; className?: string }>
> = {
  MINE: Pickaxe,
  TRADE: ArrowLeftRight,
  TRANSFER: ArrowLeftRight,
  ESCROW_LOCK: Lock,
  ESCROW_REFUND: RotateCcw,
  ADJUST: Sparkles,
  BURN: Flame,
  CONVERT: Repeat,
  PURCHASE: Banknote,
  GAME: Gamepad2,
};

function ActivityRow({ tx, email }: { tx: TransactionPublic; email: string }) {
  const Icon = TX_ICON[tx.type] ?? ArrowLeftRight;
  const incoming = tx.toEmail === email;
  const delta = incoming ? tx.amountCC : -tx.amountCC;
  const when = new Date(tx.createdAt);
  // DC carries its own flame accent; CC reads green in / red out.
  const amtTone =
    tx.currency === "DC" ? "text-flame" : delta >= 0 ? "text-teal-300" : "text-red-300";
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-mute">
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-white">{tx.memo}</div>
        <div className="text-xs text-mute">
          {when.toLocaleDateString()} ·{" "}
          {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      <div className={`text-sm font-semibold ${amtTone}`}>
        {delta >= 0 ? "+" : "−"}
        {tx.currency === "DC" ? formatDC(Math.abs(delta)) : formatCC(Math.abs(delta))}{" "}
        {tx.currency}
      </div>
    </div>
  );
}

function WalletHome() {
  const { member } = useAuth();
  const { data, loading } = useLeaderboard();
  const { transactions } = useTransactions();
  const { data: value } = useValue();
  const you = data?.rows.find((r) => r.isYou);
  const balance = member?.balance ?? 0;
  const dcBalance = member?.dcBalance ?? 0;
  const email = member?.email ?? "";
  const mySlug = email ? email.split("@")[0] : "";
  const topHolders = data?.rows.slice(0, 5) ?? [];
  const recent = (transactions ?? []).slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="px-1">
        <h1 className="font-display text-xl font-bold text-white">Your wallet</h1>
        <p className="text-sm text-mute">
          Welcome back, {member?.name?.split(" ")[0]}.{" "}
          {balance === 0 && dcBalance === 0
            ? "Head to Mine to forge your first DC."
            : "Mine DC, play the Arcade, or trade on the market."}
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Capsule Coin — the everyday currency */}
        <div className="capsule-card relative overflow-hidden p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm text-mute">
                <Wallet size={16} className="text-gold-400" /> Your CC balance
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <CountUp
                  value={balance}
                  format={formatCC}
                  className="text-4xl font-bold text-white sm:text-5xl"
                />
                <span className="text-lg font-semibold text-gold-400">CC</span>
              </div>
              {value && (
                <div className="mt-1 text-xs text-mute">
                  ≈ ৳{formatBdt(Math.abs(balance) * value.bdtPerCC)}
                  {balance < 0 ? " (debt)" : ""} at today&apos;s rate
                </div>
              )}
              <Link
                href="/market"
                className="mt-3 inline-flex items-center gap-1 text-xs text-gold-300/80 transition hover:text-gold-300"
              >
                Trade on the market <ArrowRight size={13} />
              </Link>
            </div>
            <CoinLogo size={72} glow className="shrink-0 animate-float" />
          </div>
        </div>

        {/* Dark Capsule Coin — the elite, mined currency */}
        <div className="dc-card relative overflow-hidden p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm text-mute">
                <DarkCoinLogo size={16} /> Your DC balance
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <CountUp
                  value={dcBalance}
                  format={formatDC}
                  className="text-4xl font-bold text-gradient-flame sm:text-5xl"
                />
                <span className="text-lg font-semibold text-ember-400">DC</span>
              </div>
              <div className="mt-1 text-xs text-mute">Play coin — mine it, spend it in the Arcade.</div>
              <div className="mt-3 flex items-center gap-4 text-xs">
                <Link
                  href="/arcade"
                  className="inline-flex items-center gap-1 text-ember-300/90 transition hover:text-ember-200"
                >
                  <Gamepad2 size={13} /> Play the Arcade
                </Link>
                <Link
                  href="/mine"
                  className="inline-flex items-center gap-1 text-mute transition hover:text-white"
                >
                  <Pickaxe size={13} /> Mine
                </Link>
              </div>
            </div>
            <DarkCoinLogo size={64} glow className="shrink-0 animate-float" />
          </div>
        </div>
      </section>

      {balance <= BALANCE_WARN && !member?.graceUntil && !member?.banned && (
        <div className="flex items-center gap-3 rounded-[20px] border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle size={18} className="shrink-0 text-red-300" />
          <span>
            You&apos;re at <b>{formatCC(balance)} CC</b> — nearing bankruptcy (the
            −500 CC floor). Sell something on the market or settle a request to
            climb back up.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        <ValueCard data={value} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          icon={Trophy}
          label="Your rank"
          value={you ? `#${you.rank}` : "—"}
          sub={data ? `of ${data.memberCount} members` : undefined}
        />
        <Stat
          icon={TrendingUp}
          label="Share of supply"
          value={you ? `${you.sharePct}%` : "—"}
        />
        <Stat
          icon={Layers}
          label="Total supply"
          value={data ? `${formatCC(data.totalSupply)} CC` : "—"}
        />
      </div>

      {mySlug && <BalanceHistoryCard slug={mySlug} title="Your balance over time" />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="capsule-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-white">
              <Crown size={18} className="text-gold-400" /> Top holders
            </h2>
            <Link
              href="/leaderboard"
              className="inline-flex items-center gap-1 text-sm text-teal-400 hover:text-teal-300"
            >
              Full board <ArrowRight size={14} />
            </Link>
          </div>
          <div className="mt-4 space-y-1">
            {loading && !data
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-2xl bg-white/5" />
                ))
              : topHolders.map((r) => (
                  <Link
                    key={r.email}
                    href={`/member/${r.email.split("@")[0]}`}
                    className={`group flex items-center gap-3 rounded-2xl px-3 py-2 transition hover:bg-white/5 ${
                      r.isYou ? "bg-gold-500/10" : ""
                    }`}
                  >
                    <span className="w-6 text-center text-sm font-semibold text-mute">
                      {r.rank}
                    </span>
                    <span className="flex-1 truncate text-sm text-white">
                      {r.name}
                      {r.isYou && <span className="ml-2 text-xs text-gold-400">you</span>}
                    </span>
                    <span className="text-sm font-semibold text-gold-300">
                      {formatCC(r.balance)} <span className="text-mute">CC</span>
                    </span>
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-mute/40 transition group-hover:text-mute"
                    />
                  </Link>
                ))}
          </div>
        </section>

        <section className="capsule-card p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-white">
            <History size={18} className="text-teal-400" /> Recent activity
          </h2>
          <div className="mt-3 divide-y divide-white/5">
            {recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-mute">
                No transactions yet. Mining and trades will show up here.
              </p>
            ) : (
              recent.map((tx) => <ActivityRow key={tx.id} tx={tx} email={email} />)
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
