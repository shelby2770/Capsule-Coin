"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import {
  Flame,
  Pickaxe,
  Gamepad2,
  ShoppingBasket,
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
};

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: "The Capsule is being renovated",
    body: "Our Capsule — the home where all of us live — cracked open. While it's rebuilt, the economy got an upgrade: two coins with two clear jobs. Say hello to Dark Capsule Coin.",
  },
  {
    icon: Flame,
    title: "Meet Dark Capsule Coin — DC 🔥",
    body: "DC is the play coin. You forge it by mining and by winning arcade games, and you spend it to play more. It's separate from CC — pure fun, no exchange rate to track.",
  },
  {
    icon: Coins,
    title: "Your mining history came with you",
    body: "Nothing you earned was lost. Every CC you ever mined became DC in your DC wallet, and your past mines now read in DC on your history. Your effort, upgraded to the elite coin.",
  },
  {
    icon: Pickaxe,
    title: "Mining mints DC",
    body: "Every UTC day you get free mines and a free game play — both earn DC. Want more mining? Unlock pay-to-mine packs with DC.",
  },
  {
    icon: ShoppingBasket,
    title: "CC trades · DC plays",
    body: "CC runs the real economy — every trade, big or small, settles in CC. DC is your arcade currency: earn it, spend it on games. The two don't cross over anymore.",
  },
  {
    icon: Gamepad2,
    title: "DC powers the Arcade",
    body: "Spend DC to play higher game tiers and to unlock extra mining. Every DC you spend flows back into the pool, so there's always more to mine and win.",
  },
  {
    icon: AlertTriangle,
    title: "Mind the −500 floor",
    body: "If your CC falls below −500 you get 3 days to recover by earning CC back — selling or getting paid. Miss it and the account is frozen. DC can never go negative.",
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
          <p className="mt-2 min-h-[4.5rem] text-sm leading-relaxed text-mute">
            {step.body}
          </p>

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
                <Flame size={16} /> {saving ? "Entering…" : "Enter the new economy"}
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
