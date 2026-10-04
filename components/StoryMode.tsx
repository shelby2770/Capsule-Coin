"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import {
  Flame,
  Pickaxe,
  Gamepad2,
  ClipboardList,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Coins,
} from "lucide-react";

type Step = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
  bullets?: string[];
};

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: "Welcome to the Capsule 🫧",
    body: "The Capsule is our little in-house economy — trade snacks, favours and skills with the team using our own coins. There are two of them, with two clear jobs. Here's how it all works.",
  },
  {
    icon: Coins,
    title: "Capsule Coin — CC 💰",
    body: "CC is the real currency. Every trade settles in CC: sell a burger, do a photoshoot, lend a hand — and CC moves from one wallet to another. It's a pure transfer economy, so your gain is someone else's spend; playing never mints it.",
  },
  {
    icon: Flame,
    title: "Dark Capsule Coin — DC 🔥",
    body: "DC is the play coin. You forge it by mining and by winning arcade games, then spend it to play more. DC stays in the Arcade — it never converts to CC, so there's no exchange rate to track.",
  },
  {
    icon: Pickaxe,
    title: "Earn a little every day",
    body: "Each UTC day you get 3 free mines and 1 free arcade play — they're independent, so grab both. Mining and game wins both mint DC from one shared, capped reserve, so the supply never runs wild.",
  },
  {
    icon: Gamepad2,
    title: "Spend it to go bigger",
    body: "Want more than the free draws? Spend DC to play higher game tiers (20 / 50 / 100 DC) or to unlock extra mining packs (5 / 10 / 20 attempts). Every DC you spend flows back into the reserve, so there's always more to mine and win.",
  },
  {
    icon: AlertTriangle,
    title: "Mind the −500 floor",
    body: "CC is a shared credit line, so your balance can dip negative — but only to −500. Cross it and you have 3 days to climb back above −500 by earning CC (sell something, get paid). Miss the deadline and the account freezes. DC can never go negative.",
  },
  {
    icon: ClipboardList,
    title: "House rules & fair play",
    body: "A few ground rules before you dive in:",
    bullets: [
      "Keep trades real and honest — CC is trust between teammates.",
      "DC is play-only and never converts back to CC.",
      "Free mines and plays don't roll over — use them each day.",
      "No copying or screenshotting Arcade puzzles to feed an AI — it trips a 3-day ban on that game.",
      "Have fun. Mine, play, trade, repeat.",
    ],
  },
];

/**
 * First-login DC story. Shows once (gated on member.onboardedAt); "Enter" marks
 * it seen via /api/onboard so it never reappears.
 */
export function StoryMode() {
  const { member, authedFetch, refresh } = useAuth();
  const [i, setI] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!member || member.onboardedAt || dismissed) return null;

  const step = STEPS[i];
  const Icon = step.icon;
  const last = i === STEPS.length - 1;

  const finish = async () => {
    setSaving(true);
    try {
      await authedFetch("/api/onboard", { method: "POST" });
      await refresh();
    } catch {
      /* even if the write fails, don't trap the member behind the modal */
    }
    setDismissed(true);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm">
      <div className="dc-card animate-cap-slam relative w-full max-w-lg overflow-hidden p-7">
        {/* ember glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-ember-500/20 blur-3xl"
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <DarkCoinLogo size={40} glow />
            <span className="font-display text-lg font-semibold tracking-tight">
              Dark<span className="text-ember-400">Capsule</span>
            </span>
            <span className="ml-auto text-xs text-mute">
              {i + 1} / {STEPS.length}
            </span>
          </div>

          <div className="mt-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-400">
            <Icon size={24} />
          </div>
          <h2 className="mt-4 font-display text-2xl font-semibold text-white">
            {step.title}
          </h2>
          <div className="mt-2 min-h-[6.5rem]">
            <p className="text-sm leading-relaxed text-mute">{step.body}</p>
            {step.bullets ? (
              <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-mute">
                {step.bullets.map((b, n) => (
                  <li key={n} className="flex gap-2.5">
                    <span aria-hidden className="mt-2 h-1 w-1 flex-none rounded-full bg-ember-500" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* progress dots */}
          <div className="mt-5 flex gap-1.5">
            {STEPS.map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all ${
                  n === i ? "w-6 bg-ember-500" : "w-1.5 bg-white/15"
                }`}
              />
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <button
              className="btn-ghost dc-ring"
              onClick={() => setI((n) => Math.max(0, n - 1))}
              disabled={i === 0 || saving}
            >
              <ArrowLeft size={16} /> Back
            </button>
            {last ? (
              <button className="btn-ember dc-ring" onClick={finish} disabled={saving}>
                <Flame size={16} /> {saving ? "Entering…" : "Enter the Capsule"}
              </button>
            ) : (
              <button className="btn-ember dc-ring" onClick={() => setI((n) => n + 1)}>
                Next <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
