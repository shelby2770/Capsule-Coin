"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useLeaderboard } from "@/lib/useLeaderboard";
import { formatCC, formatDC, balanceStanding } from "@/lib/format";
import type { LeaderboardRow } from "@/lib/types";
import {
  Trophy,
  Flame,
  Loader2,
  Layers,
  Users,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  Ban,
  ChevronRight,
} from "lucide-react";

export default function LeaderboardPage() {
  return (
    <AppShell>
      <Leaderboard />
    </AppShell>
  );
}

type View = "CC" | "DC";

const MEDAL: Record<View, Record<number, string>> = {
  CC: {
    1: "bg-gold-500/20 border-gold-500/40",
    2: "bg-white/10 border-white/20",
    3: "bg-orange-500/15 border-orange-500/30",
  },
  DC: {
    1: "bg-ember-500/25 border-ember-500/50",
    2: "bg-white/10 border-white/20",
    3: "bg-ember-700/20 border-ember-600/40",
  },
};
const MEDAL_EMOJI: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function Rank({ rank, medal }: { rank: number; medal: Record<number, string> }) {
  const cls = medal[rank];
  if (cls) {
    return (
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-capsule border text-base ${cls}`}
        title={`#${rank}`}
      >
        {MEDAL_EMOJI[rank]}
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center text-sm font-semibold text-mute">
      {rank}
    </span>
  );
}

/** Escalating credit-standing badge: near bankrupt → bankrupt → frozen. */
function StandingBadge({ balance, banned }: { balance: number; banned: boolean }) {
  const st = balanceStanding(balance, banned);
  if (st === "frozen")
    return (
      <span className="chip border-red-500/50 bg-red-500/10 py-0.5 text-[11px] font-medium text-red-300">
        <Ban size={11} /> frozen
      </span>
    );
  if (st === "bankrupt")
    return (
      <span className="chip border-red-500/40 py-0.5 text-[11px] font-medium text-red-300">
        <AlertTriangle size={11} /> bankrupt
      </span>
    );
  if (st === "warn")
    return (
      <span className="chip border-amber-500/40 py-0.5 text-[11px] text-amber-300">
        <AlertTriangle size={11} /> near bankrupt
      </span>
    );
  return null;
}

function Leaderboard() {
  const { data, loading, error, refresh } = useLeaderboard();
  const [view, setView] = useState<View>("CC");
  const isDc = view === "DC";

  // CC rows come balance-sorted from the server. For DC, re-sort by holdings and
  // recompute rank + share of the DC supply on the client.
  const rows = useMemo<LeaderboardRow[]>(() => {
    const base = data?.rows ?? [];
    if (!isDc) return base;
    const totalDc = data?.totalDc ?? 0;
    const sorted = [...base].sort(
      (a, b) => b.dcBalance - a.dcBalance || a.name.localeCompare(b.name),
    );
    let lastVal: number | null = null;
    let lastRank = 0;
    return sorted.map((r, i) => {
      const rank = lastVal !== null && r.dcBalance === lastVal ? lastRank : i + 1;
      lastVal = r.dcBalance;
      lastRank = rank;
      return {
        ...r,
        rank,
        sharePct:
          totalDc > 0
            ? Number(((Math.max(0, r.dcBalance) / totalDc) * 100).toFixed(1))
            : 0,
      };
    });
  }, [data, isDc]);

  const medal = MEDAL[view];
  const accent = isDc ? "text-ember-400" : "text-gold-400";
  const amountTone = isDc ? "text-ember-300" : "text-gold-300";
  const barGrad = isDc ? "from-ember-400 to-ember-600" : "from-gold-400 to-gold-600";
  const total = isDc ? data?.totalDc : data?.totalSupply;
  const fmt = isDc ? formatDC : formatCC;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
          {isDc ? (
            <Flame size={22} className="text-ember-400" />
          ) : (
            <Trophy size={22} className="text-gold-400" />
          )}
          Leaderboard
        </h1>
        <div className="flex items-center gap-2">
          {/* CC / DC toggle */}
          <div className="inline-flex rounded-capsule border border-edge bg-ink-900/40 p-1">
            <button
              onClick={() => setView("CC")}
              className={`rounded-[10px] px-3 py-1 text-sm font-semibold transition ${
                !isDc ? "bg-gold-500/15 text-gold-300" : "text-mute hover:text-white"
              }`}
            >
              CC
            </button>
            <button
              onClick={() => setView("DC")}
              className={`inline-flex items-center gap-1 rounded-[10px] px-3 py-1 text-sm font-semibold transition ${
                isDc ? "bg-ember-500/20 text-ember-300" : "text-mute hover:text-white"
              }`}
            >
              <Flame size={13} /> DC
            </button>
          </div>
          <button
            onClick={() => void refresh()}
            className="btn-ghost"
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className={`${isDc ? "dc-card" : "capsule-card"} p-4`}>
          <div className="flex items-center gap-2 text-xs text-mute">
            {isDc ? (
              <Flame size={14} className="text-ember-400" />
            ) : (
              <Layers size={14} className="text-gold-400" />
            )}{" "}
            {isDc ? "Total DC" : "Total supply"}
          </div>
          <div className="mt-1 text-xl font-bold text-white">
            {data ? fmt(total ?? 0) : "—"}{" "}
            <span className={`text-sm ${accent}`}>{view}</span>
          </div>
        </div>
        <div className="capsule-card p-4">
          <div className="flex items-center gap-2 text-xs text-mute">
            <Users size={14} className="text-teal-400" /> Joined
          </div>
          <div className="mt-1 text-xl font-bold text-white">
            {data ? `${data.joinedCount}/${data.memberCount}` : "—"}
          </div>
        </div>
        <div className="capsule-card col-span-2 p-4 sm:col-span-1">
          <div className="flex items-center gap-2 text-xs text-mute">
            <ShieldCheck size={14} className="text-teal-400" /> Visibility
          </div>
          <div className="mt-1 text-sm font-medium text-white">
            {isDc
              ? "DC holdings are public to all members"
              : "Balances are public to all members"}
          </div>
        </div>
      </div>

      {error && (
        <div className="capsule-card flex items-center gap-2 p-4 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <section className={`${isDc ? "dc-card" : "capsule-card"} overflow-hidden`}>
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-mute">
            <Loader2 size={20} className={`animate-spin ${accent}`} /> Loading
            standings…
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {rows.map((r) => {
              const negative = !isDc && r.balance < 0;
              const shownAmount = isDc ? r.dcBalance : r.balance;
              return (
                <li
                  key={r.email}
                  className={r.isYou ? (isDc ? "bg-ember-500/[0.07]" : "bg-gold-500/[0.07]") : ""}
                >
                  <Link
                    href={`/member/${r.email.split("@")[0]}`}
                    className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[0.03] sm:px-6"
                  >
                    <Rank rank={r.rank} medal={medal} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`truncate font-medium ${
                            r.joined ? "text-white" : "text-mute"
                          }`}
                        >
                          {r.name}
                        </span>
                        {r.isYou && (
                          <span
                            className={`chip py-0.5 text-[11px] ${
                              isDc
                                ? "border-ember-500/40 text-ember-300"
                                : "border-gold-500/40 text-gold-300"
                            }`}
                          >
                            you
                          </span>
                        )}
                        <span className="hidden text-[11px] text-teal-300/80 sm:inline">
                          {r.role}
                        </span>
                        {!r.joined && (
                          <span className="text-[11px] text-mute/70">not joined yet</span>
                        )}
                        {/* CC view: full standing escalation. DC view: only the frozen flag. */}
                        {isDc ? (
                          r.banned && <StandingBadge balance={r.balance} banned={r.banned} />
                        ) : (
                          <StandingBadge balance={r.balance} banned={r.banned} />
                        )}
                      </div>
                      {/* share / debt bar */}
                      <div className="mt-1.5 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-white/5">
                        {negative ? (
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-red-500 to-red-700"
                            style={{
                              width: `${Math.min(100, (Math.abs(r.balance) / 500) * 100)}%`,
                            }}
                          />
                        ) : (
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${barGrad}`}
                            style={{ width: `${Math.min(100, r.sharePct)}%` }}
                          />
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-semibold ${
                          negative ? "text-red-300" : amountTone
                        }`}
                      >
                        {fmt(shownAmount)}{" "}
                        <span className="text-xs text-mute">{view}</span>
                      </div>
                      <div
                        className={`text-xs ${negative ? "text-red-300/70" : "text-mute"}`}
                      >
                        {negative
                          ? `${Math.round((Math.abs(r.balance) / 500) * 100)}%`
                          : `${r.sharePct}%`}
                      </div>
                    </div>
                    <ChevronRight
                      size={16}
                      className="shrink-0 text-mute/40 transition group-hover:text-mute"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
