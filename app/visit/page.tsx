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
  Gamepad2,
  Store,
  Repeat,
  ShieldCheck,
  Loader2,
  LogOut,
} from "lucide-react";

type Feature = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
};

const FEATURES: Feature[] = [
  {
    icon: Coins,
    title: "Two coins, one economy",
    body: "Capsule Coin (CC) is the spendable currency — its value floats on how spread-out everyone's holdings are. Dark Capsule Coin (DC) is the rarer coin you forge by playing, then convert back to CC.",
  },
  {
    icon: Pickaxe,
    title: "Mining forges DC",
    body: "Draw tokens against a secret vault each day — every collision mints DC from a fixed reserve. A few free draws a day, or burn CC to mine harder tiers for bigger rewards.",
  },
  {
    icon: Gamepad2,
    title: "The Arcade",
    body: "Four games — Guess the Word, Type Racing, Problem Solving, and AI Blitz — each pay out DC when you win. One free play a day across the games, with paid tiers for higher stakes.",
  },
  {
    icon: Store,
    title: "The Market",
    body: "Send and trade CC with other members, haggle over deals, and settle transfers. Every move is written to a tamper-evident ledger everyone can audit.",
  },
  {
    icon: Repeat,
    title: "Convert DC → CC",
    body: "Turn the DC you've forged back into spendable CC. Converting destroys DC and reopens reserve headroom, so mining and games can keep paying out.",
  },
  {
    icon: Vault,
    title: "A capped supply",
    body: "Mining and games mint DC from the same fixed reserve, so DC can't inflate away. The economy stays bounded no matter how hard everyone plays.",
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

      {/* how it works */}
      <section className="mt-10">
        <h2 className="text-center font-display text-xl font-semibold text-white">
          How it works
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="dc-card p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-400">
                  <Icon size={22} />
                </div>
                <h3 className="mt-3 font-display text-lg font-semibold text-white">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-mute">{f.body}</p>
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
          Only the {ov ? ov.members : 16} Capsule members can mine, play, trade, and hold coins. Ask
          Adnan to add you to the allowlist — then sign back in and your wallet is waiting.
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
