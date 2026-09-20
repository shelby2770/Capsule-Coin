"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { formatDC } from "@/lib/format";
import type { ArcadeStatus } from "@/lib/types";
import {
  Gamepad2,
  Pickaxe,
  Puzzle,
  Keyboard,
  Code2,
  Zap,
  Vault,
  ArrowRight,
  Play,
  Layers,
} from "lucide-react";

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export default function ArcadePage() {
  return (
    <AppShell>
      <Arcade />
    </AppShell>
  );
}

function Arcade() {
  const { authedFetch } = useAuth();
  const [status, setStatus] = useState<ArcadeStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const r = await authedFetch("/api/arcade");
      if (r.ok) setStatus((await r.json()) as ArcadeStatus);
    } catch {
      /* ignore */
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const freeLeft = status?.freeRemaining ?? 0;
  const reserve = status?.reserveRemaining ?? 0;
  const reservePct = status
    ? Math.max(0, Math.min(100, (reserve / status.supplyCap) * 100))
    : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="text-center">
        <h1 className="flex items-center justify-center gap-2 font-display text-2xl font-bold text-white">
          <Gamepad2 size={22} className="text-ember-400" /> Arcade
        </h1>
        <p className="mt-1 text-sm text-mute">
          Forge Dark Capsule Coin — by mining, or by winning games.
        </p>
      </div>

      {/* shared free-play banner */}
      <div className="dc-card flex flex-wrap items-center gap-3 p-4">
        <div className="text-sm">
          {!status ? (
            <span className="text-mute">Loading…</span>
          ) : freeLeft > 0 ? (
            <span className="text-white">
              You have <span className="text-ember-300">1 free play</span> today — spend it on any game.
            </span>
          ) : (
            <span className="text-mute">
              Free play used today · refills in{" "}
              <span className="text-white">{fmtCountdown(status.resetsAtMs - now)}</span>. Paid tiers are always open.
            </span>
          )}
        </div>
      </div>

      {reserve <= 0 && status && (
        <div className="rounded-2xl border border-ember-500/40 bg-ember-500/10 p-3 text-center text-sm text-ember-200">
          The DC reserve is tapped out — wins pay nothing until members convert DC back to CC.
        </div>
      )}

      {/* game cards — 6-col track so each card spans 2; the 4th card starts at
          column 2 so the final row of two (Problem Solving + AI Blitz) centers. */}
      <div className="grid gap-4 sm:grid-cols-6">
        <GameCard
          href="/mine"
          icon={Pickaxe}
          title="Mining Rig"
          blurb="Draw tokens against the secret vault — every collision forges DC."
          freeLeft={freeLeft}
          resume={false}
          meta=""
          className="sm:col-span-2"
        />
        <GameCard
          href="/arcade/word"
          icon={Puzzle}
          title="Guess the Word"
          blurb="Wordle-style. Solve fast and in few tries for the biggest DC."
          freeLeft={freeLeft}
          resume={status?.resumable?.kind === "word"}
          meta={status ? `${status.wordsRemaining.toLocaleString()} words left` : ""}
          className="sm:col-span-2"
        />
        <GameCard
          href="/arcade/type"
          icon={Keyboard}
          title="Type Racing"
          blurb="Type a passage cleanly and fast. Faster = more DC."
          freeLeft={freeLeft}
          resume={status?.resumable?.kind === "type"}
          meta={status ? `${status.paragraphsRemaining.toLocaleString()} passages` : ""}
          className="sm:col-span-2"
        />
        <GameCard
          href="/arcade/problem"
          icon={Code2}
          title="Problem Solving"
          blurb="Crack a LeetCode-style problem in 5 min. An AI judge scores it for DC."
          freeLeft={freeLeft}
          resume={false}
          meta={status ? `${status.problemsRemaining.toLocaleString()} problems` : ""}
          className="sm:col-span-2 sm:col-start-2"
        />
        <GameCard
          href="/arcade/blitz"
          icon={Zap}
          title="AI Blitz"
          blurb="Rapid-fire AI/ML MCQs — 20s each. Every correct answer forges DC."
          freeLeft={freeLeft}
          resume={false}
          meta={status ? `${status.mcqRemaining.toLocaleString()} questions` : ""}
          className="sm:col-span-2"
        />
      </div>

      {/* reserve bar */}
      <section className="capsule-card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 text-mute">
            <Vault size={15} className="text-teal-400" /> Shared DC reserve
          </span>
          <span className="font-semibold text-white">
            {status ? formatDC(reserve) : "—"}
            <span className="text-mute"> / {status ? status.supplyCap.toLocaleString() : "—"} DC</span>
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-400 to-ember-500 transition-all duration-700"
            style={{ width: `${reservePct}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-mute">
          Mining and games mint DC from the same fixed reserve, so DC can&apos;t inflate away.
          Converting DC → CC reopens headroom.
        </p>
      </section>
    </div>
  );
}

function GameCard({
  href,
  icon: Icon,
  title,
  blurb,
  meta,
  freeLeft,
  resume,
  className,
}: {
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  blurb: string;
  meta: string;
  freeLeft: number;
  resume: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`dc-card group flex flex-col p-5 transition hover:border-ember-500/40${
        className ? ` ${className}` : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-400">
          <Icon size={22} />
        </div>
        {resume ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/15 px-2 py-0.5 text-[11px] font-semibold text-teal-300">
            <Play size={11} /> Resume
          </span>
        ) : freeLeft > 0 ? (
          <span className="rounded-full bg-ember-500/15 px-2 py-0.5 text-[11px] font-semibold text-ember-300">
            Free play
          </span>
        ) : null}
      </div>
      <h2 className="mt-3 font-display text-lg font-semibold text-white">{title}</h2>
      <p className="mt-1 flex-1 text-sm text-mute">{blurb}</p>
      <div className="mt-3 flex items-center justify-between text-[11px] text-mute">
        {meta ? (
          <span className="inline-flex items-center gap-1">
            <Layers size={12} className="text-mute" /> {meta}
          </span>
        ) : (
          <span />
        )}
        <ArrowRight size={15} className="text-ember-400 transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
