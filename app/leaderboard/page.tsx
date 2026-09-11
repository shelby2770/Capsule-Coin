"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useLeaderboard } from "@/lib/useLeaderboard";
import { formatCC, BALANCE_WARN } from "@/lib/format";
import type { LeaderboardRow } from "@/lib/types";
import {
  Trophy,
  Loader2,
  Layers,
  Users,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";

export default function LeaderboardPage() {
  return (
    <AppShell>
      <Leaderboard />
    </AppShell>
  );
}

const MEDAL: Record<number, string> = {
  1: "bg-gold-500/20 border-gold-500/40",
  2: "bg-white/10 border-white/20",
  3: "bg-orange-500/15 border-orange-500/30",
};
const MEDAL_EMOJI: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function Rank({ row }: { row: LeaderboardRow }) {
  const cls = MEDAL[row.rank];
  if (cls) {
    return (
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-capsule border text-base ${cls}`}
        title={`#${row.rank}`}
      >
        {MEDAL_EMOJI[row.rank]}
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center text-sm font-semibold text-mute">
      {row.rank}
    </span>
  );
}

function Leaderboard() {
  const { data, loading, error, refresh } = useLeaderboard();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
          <Trophy size={22} className="text-gold-400" /> Leaderboard
        </h1>
        <button
          onClick={() => void refresh()}
          className="btn-ghost"
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="capsule-card p-4">
          <div className="flex items-center gap-2 text-xs text-mute">
            <Layers size={14} className="text-gold-400" /> Total supply
          </div>
          <div className="mt-1 text-xl font-bold text-white">
            {data ? formatCC(data.totalSupply) : "—"}{" "}
            <span className="text-sm text-gold-400">CC</span>
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
            Balances are public to all members
          </div>
        </div>
      </div>

      {error && (
        <div className="capsule-card flex items-center gap-2 p-4 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <section className="capsule-card overflow-hidden">
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-mute">
            <Loader2 size={20} className="animate-spin text-gold-400" /> Loading
            standings…
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {data?.rows.map((r) => (
              <li key={r.email} className={r.isYou ? "bg-gold-500/[0.07]" : ""}>
                <Link
                  href={`/member/${r.email.split("@")[0]}`}
                  className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[0.03] sm:px-6"
                >
                  <Rank row={r} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`truncate font-medium ${
                        r.joined ? "text-white" : "text-mute"
                      }`}
                    >
                      {r.name}
                    </span>
                    {r.isYou && (
                      <span className="chip border-gold-500/40 py-0.5 text-[11px] text-gold-300">
                        you
                      </span>
                    )}
                    <span className="hidden text-[11px] text-teal-300/80 sm:inline">
                      {r.role}
                    </span>
                    {!r.joined && (
                      <span className="text-[11px] text-mute/70">
                        not joined yet
                      </span>
                    )}
                    {r.balance <= BALANCE_WARN && (
                      <span className="chip border-red-500/40 py-0.5 text-[11px] text-red-300">
                        <AlertTriangle size={11} /> near bankrupt
                      </span>
                    )}
                  </div>
                  {/* share / debt bar */}
                  <div className="mt-1.5 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-white/5">
                    {r.balance < 0 ? (
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-red-500 to-red-700"
                        style={{
                          width: `${Math.min(100, (Math.abs(r.balance) / 500) * 100)}%`,
                        }}
                      />
                    ) : (
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-gold-400 to-gold-600"
                        style={{ width: `${Math.min(100, r.sharePct)}%` }}
                      />
                    )}
                  </div>
                </div>
                  <div className="text-right">
                    <div
                      className={`font-semibold ${
                        r.balance < 0 ? "text-red-300" : "text-gold-300"
                      }`}
                    >
                      {formatCC(r.balance)}{" "}
                      <span className="text-xs text-mute">CC</span>
                    </div>
                    <div
                      className={`text-xs ${
                        r.balance < 0 ? "text-red-300/70" : "text-mute"
                      }`}
                    >
                      {r.balance < 0
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
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
