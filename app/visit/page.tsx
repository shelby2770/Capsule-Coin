"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isOrbitaxEmail } from "@/lib/domain";
import { CoinLogo } from "@/components/CoinLogo";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { formatDC } from "@/lib/format";
import type { PublicOverview } from "@/lib/types";
import {
  Sparkles,
  Coins,
  Vault,
  Users,
  TrendingUp,
  TrendingDown,
  Pickaxe,
  Puzzle,
  Keyboard,
  Code2,
  Zap,
  Store,
  Repeat,
  ShieldCheck,
  Loader2,
  LogOut,
} from "lucide-react";

// ── how-it-plays mini illustrations ──────────────────────────────────────────
// Small, static representations of each activity's core mechanic. Hardcoded
// sample state (not live) — just enough to show a visitor how the game feels.

function MiningViz() {
  // Draw tokens against a hidden vault; the matches (collisions) forge DC.
  const hits = new Set([2, 5, 6]);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex gap-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <span
            key={i}
            aria-hidden
            className={
              hits.has(i)
                ? "h-6 w-6 rounded-full bg-ember-500/30 shadow-[0_0_10px_rgba(255,120,40,0.45)] ring-1 ring-ember-400/60"
                : "h-6 w-6 rounded-full border border-white/10 bg-white/[0.03]"
            }
          />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1 font-display text-base font-bold text-gradient-flame">
        <DarkCoinLogo size={16} /> +3
      </div>
    </div>
  );
}

type Tile = "c" | "p" | "a"; // correct / present / absent
const TILE_CLASS: Record<Tile, string> = {
  c: "bg-teal-500/85 text-white ring-teal-400/40",
  p: "bg-gold-500/80 text-ink-900 ring-gold-400/40",
  a: "bg-white/[0.06] text-mute ring-white/10",
};

function WordViz() {
  // Wordle-style clues: a first guess (mixed) resolving to the answer FORGE.
  const rows: Array<Array<[string, Tile]>> = [
    [["F", "c"], ["R", "p"], ["A", "a"], ["M", "a"], ["E", "c"]],
    [["F", "c"], ["O", "c"], ["R", "c"], ["G", "c"], ["E", "c"]],
  ];
  return (
    <div className="flex flex-col items-center gap-1.5">
      {rows.map((row, r) => (
        <div key={r} className="flex gap-1.5">
          {row.map(([ch, s], i) => (
            <span
              key={i}
              className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold ring-1 ${TILE_CLASS[s]}`}
            >
              {ch}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function TypeViz() {
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-black/30 px-3 py-2 font-mono text-[13px] leading-relaxed">
        <span className="rounded bg-teal-500/15 text-teal-200">The quick brown </span>
        <span className="mx-px inline-block h-4 w-0.5 animate-pulse rounded bg-ember-400 align-text-bottom" />
        <span className="text-mute/50">fox jumps over…</span>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="chip border-ember-500/30 text-ember-300 tabular-nums">82 WPM</span>
        <span className="text-mute">faster &amp; cleaner = more DC</span>
      </div>
    </div>
  );
}

function ProblemViz() {
  const rubric = [
    { label: "Approach", v: 4, max: 4 },
    { label: "Correctness", v: 2, max: 3 },
    { label: "Efficiency", v: 1, max: 2 },
    { label: "Edge cases", v: 0, max: 1 },
  ];
  return (
    <div className="space-y-2.5">
      <div className="rounded-lg bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed">
        <div>
          <span className="text-ember-300">for</span> <span className="text-white/80">x</span>{" "}
          <span className="text-ember-300">in</span> <span className="text-white/80">nums:</span>
        </div>
        <div className="pl-3 text-white/80">
          <span className="text-teal-300">seen</span>.add(x)
        </div>
      </div>
      <div className="space-y-1">
        {rubric.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-[10px] text-mute">{r.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-ember-500"
                style={{ width: `${(r.v / r.max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="text-right font-display text-sm font-bold text-white">
        7<span className="text-mute">/10</span>
      </div>
    </div>
  );
}

function BlitzViz() {
  const opts: Array<{ k: string; t: string; ok?: boolean }> = [
    { k: "A", t: "Sigmoid", ok: true },
    { k: "B", t: "Linear" },
    { k: "C", t: "Identity" },
    { k: "D", t: "Constant" },
  ];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-white/80">Which is non-linear?</span>
        <span className="chip border-ember-500/30 text-ember-300 tabular-nums">0:23</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {opts.map((o) => (
          <span
            key={o.k}
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] ring-1 ${
              o.ok
                ? "bg-teal-500/20 text-teal-200 ring-teal-400/40"
                : "bg-white/5 text-mute ring-white/10"
            }`}
          >
            <span className="font-bold">{o.k}</span> {o.t}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${i < 2 ? "bg-ember-500" : "bg-white/10"}`}
          />
        ))}
        <span className="ml-1 shrink-0 text-[10px] text-mute">Q3/5</span>
      </div>
    </div>
  );
}

type Game = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  caption: string;
  Viz: React.ComponentType;
};

const GAMES: Game[] = [
  { icon: Pickaxe, title: "Mining Rig", caption: "Draw against the hidden vault — every match forges DC.", Viz: MiningViz },
  { icon: Puzzle, title: "Guess the Word", caption: "Crack the hidden word from green / gold / grey clues.", Viz: WordViz },
  { icon: Keyboard, title: "Type Racing", caption: "Type a passage fast and clean — your WPM sets the payout.", Viz: TypeViz },
  { icon: Code2, title: "Problem Solving", caption: "Sketch a solution; an AI judge scores it out of 10 for DC.", Viz: ProblemViz },
  { icon: Zap, title: "AI Blitz", caption: "Rapid-fire AI / ML multiple choice — beat the clock.", Viz: BlitzViz },
];

type Concept = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
};

const ECONOMY: Concept[] = [
  {
    icon: Coins,
    title: "Two coins",
    body: "CC is the spendable currency — its value floats on how spread-out everyone's holdings are. DC is the rarer coin you forge by playing.",
  },
  {
    icon: Repeat,
    title: "Convert DC → CC",
    body: "Turn the DC you've forged back into spendable CC. Converting destroys DC and reopens reserve headroom for more play.",
  },
  {
    icon: Store,
    title: "The Market",
    body: "Send and trade CC with other members, haggle over deals, and settle transfers — every move on a tamper-evident ledger.",
  },
  {
    icon: Vault,
    title: "Capped supply",
    body: "Mining and games mint DC from one fixed reserve, so DC can't inflate away no matter how hard everyone plays.",
  },
];

export default function VisitPage() {
  const router = useRouter();
  const { status, email, signOut, authedFetch } = useAuth();
  const [ov, setOv] = useState<PublicOverview | null>(null);

  const isGuest = status === "notMember" && isOrbitaxEmail(email);

  // Route everyone who isn't an authenticated orbitax non-member away: members go
  // to the real app, signed-out users to login, and non-orbitax accounts to the
  // login dead-end. Only orbitax non-members stay to see the tour.
  useEffect(() => {
    if (status === "loading") return;
    if (status === "signedOut") router.replace("/login");
    else if (status === "member") router.replace("/dashboard");
    else if (status === "notMember" && !isOrbitaxEmail(email)) router.replace("/login");
  }, [status, email, router]);

  const load = useCallback(async () => {
    try {
      const r = await authedFetch("/api/visit");
      if (r.ok) setOv((await r.json()) as PublicOverview);
    } catch {
      /* stats are a nice-to-have; the tour still stands without them */
    }
  }, [authedFetch]);

  useEffect(() => {
    if (isGuest) void load();
  }, [isGuest, load]);

  // While auth resolves or a redirect is pending, show a quiet spinner.
  if (!isGuest) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <Loader2 size={26} className="animate-spin text-gold-400" />
      </main>
    );
  }

  const reservePct = ov
    ? Math.max(0, Math.min(100, (ov.dcReserveRemaining / Math.max(1, ov.dcSupplyCap)) * 100))
    : 0;

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-5 py-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <CoinLogo size={34} />
          <span className="font-display text-lg font-semibold tracking-tight">
            Capsule<span className="text-gold-400">Coin</span>
          </span>
          <span className="chip border-teal-500/30 text-teal-300">Guest view</span>
        </div>
        <button
          onClick={() => void signOut()}
          className="btn-ghost"
          title="Sign out / switch account"
        >
          <LogOut size={16} /> <span className="hidden sm:inline">Sign out</span>
        </button>
      </header>

      {/* hero */}
      <section className="animate-rise mt-10 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-capsule bg-gold-500/15 text-gold-300">
          <Sparkles size={30} />
        </div>
        <h1 className="mt-5 font-display text-3xl font-bold text-white sm:text-4xl">
          A look inside <span className="text-gradient-gold">Capsule Coin</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-mute">
          A play-money economy built for the 16-person Capsule team. You&apos;re signed in as{" "}
          <span className="text-white">{email}</span> — not a member yet, so here&apos;s a
          read-only tour of how it all works.
        </p>
      </section>

      {/* live stats */}
      <section className="mt-8 grid gap-3 sm:grid-cols-3">
        {/* CC value */}
        <div className="capsule-card p-5">
          <div className="flex items-center gap-2 text-xs text-mute">
            <Coins size={14} className="text-gold-400" /> CC live value
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-white">
            {ov ? `৳${ov.bdtPerCC.toFixed(2)}` : "—"}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-mute">
            {ov ? <span>≈ ${ov.usdPerCC.toFixed(4)} USD</span> : <span>&nbsp;</span>}
            {ov &&
              (ov.change24h === null ? (
                <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                  new
                </span>
              ) : (
                <span
                  className={`inline-flex items-center gap-0.5 font-semibold ${
                    ov.change24h >= 0 ? "text-teal-300" : "text-red-300"
                  }`}
                >
                  {ov.change24h >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {ov.change24h >= 0 ? "+" : ""}
                  {ov.change24h}%
                </span>
              ))}
          </div>
        </div>

        {/* DC reserve */}
        <div className="capsule-card p-5">
          <div className="flex items-center gap-2 text-xs text-mute">
            <Vault size={14} className="text-teal-400" /> DC reserve left
          </div>
          <div className="mt-2 flex items-baseline gap-1.5 font-display text-2xl font-bold text-white">
            <DarkCoinLogo size={20} /> {ov ? formatDC(ov.dcReserveRemaining) : "—"}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-400 to-ember-500 transition-all duration-700"
              style={{ width: `${reservePct}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-mute">
            of {ov ? ov.dcSupplyCap.toLocaleString() : "—"} DC fixed cap
          </div>
        </div>

        {/* members */}
        <div className="capsule-card p-5">
          <div className="flex items-center gap-2 text-xs text-mute">
            <Users size={14} className="text-gold-400" /> Capsule members
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-white">
            {ov ? ov.members : "—"}
          </div>
          <div className="mt-1 text-[11px] text-mute">the whole group</div>
        </div>
      </section>

      {/* ways to forge DC — each with a mini illustration of how it plays */}
      <section className="mt-10">
        <h2 className="text-center font-display text-xl font-semibold text-white">
          Ways to forge DC
        </h2>
        <p className="mx-auto mt-1 max-w-md text-center text-sm text-mute">
          Five ways to earn — here&apos;s how each one plays.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {GAMES.map((g) => {
            const Icon = g.icon;
            const Viz = g.Viz;
            return (
              <div key={g.title} className="dc-card flex flex-col p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-400">
                    <Icon size={20} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold text-white">{g.title}</h3>
                    <p className="text-[12px] leading-snug text-mute">{g.caption}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-1 flex-col justify-center rounded-xl border border-white/10 bg-black/20 p-3">
                  <Viz />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* the economy around the games */}
      <section className="mt-10">
        <h2 className="text-center font-display text-xl font-semibold text-white">
          The economy around it
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {ECONOMY.map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.title} className="dc-card p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-400">
                  <Icon size={22} />
                </div>
                <h3 className="mt-3 font-display text-lg font-semibold text-white">{c.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-mute">{c.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="dc-card mt-10 p-7 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-500/15 text-gold-300">
          <ShieldCheck size={24} />
        </div>
        <h2 className="mt-4 font-display text-xl font-semibold text-white">Want your own wallet?</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-mute">
          Only the {ov ? ov.members : 16} Capsule members can mine, play, trade, and hold coins.
          Membership is invite-only — once you&apos;re added, sign back in and your wallet is
          waiting.
        </p>
        <button onClick={() => void signOut()} className="btn-ghost mt-5">
          <LogOut size={16} /> Sign out / switch account
        </button>
      </section>

      <p className="mt-8 text-center text-xs text-mute">
        You&apos;re viewing Capsule Coin as a guest. Nothing here can be changed from this view.
      </p>
    </div>
  );
}
