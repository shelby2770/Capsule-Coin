"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  Pickaxe,
  Gamepad2,
  Puzzle,
  Keyboard,
  Code2,
  Zap,
  Ticket,
  Trophy,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";

type Step = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    icon: Pickaxe,
    title: "Mining got a little… repetitive",
    body: "Swing, wait out the cooldown, swing again. Mining still forges DC and always will — but let's be honest, doing the same thing every day got old.",
  },
  {
    icon: Gamepad2,
    title: "So we built an Arcade 🎮",
    body: "A new way to earn the same coin: play, and forge DC by winning. Mining moved into the Arcade too — it's all one hub now, and every game pays out from the very same DC reserve.",
  },
  {
    icon: Puzzle,
    title: "Guess the Word",
    body: "A Wordle-style hunt: crack the hidden word from green/yellow/grey clues. The faster and fewer your guesses, the more DC you forge.",
  },
  {
    icon: Keyboard,
    title: "Type Racing",
    body: "Type a tricky passage as fast — and cleanly — as you can. Your net words-per-minute sets the payout. Paid tiers hand you easier passages and pay a fatter multiplier.",
  },
  {
    icon: Code2,
    title: "Problem Solving",
    body: "A LeetCode-style problem lands on a 5-minute clock. Sketch your approach, add code if you can, and an AI judge scores your work across four marks — you earn DC for every bit of real progress, not just a perfect answer.",
  },
  {
    icon: Zap,
    title: "AI Blitz",
    body: "Rapid-fire AI & machine-learning multiple choice. Five questions, thirty seconds each, one DC per correct answer. Trust your gut and go fast.",
  },
  {
    icon: Ticket,
    title: "Free every day — or pay to go bigger",
    body: "Mining keeps its own free draws each day. On top of that, the four games share one free play a day — pick your favourite. Want more? Burn CC to unlock higher tiers with bigger DC rewards. Every win mints DC from the shared reserve, so the supply stays capped.",
  },
];

/**
 * Arcade intro story. Shows once, AFTER the DC intro is done (gated on
 * member.onboardedAt set && member.arcadeOnboardedAt null) so the two never
 * stack. "Enter the Arcade" marks it seen via /api/onboard/arcade.
 */
export function ArcadeStory() {
  const { member, authedFetch, refresh } = useAuth();
  const [i, setI] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Only after the DC story is finished, and only until the arcade story is seen.
  if (!member || !member.onboardedAt || member.arcadeOnboardedAt || dismissed) return null;

  const step = STEPS[i];
  const Icon = step.icon;
  const last = i === STEPS.length - 1;

  const finish = async () => {
    setSaving(true);
    try {
      await authedFetch("/api/onboard/arcade", { method: "POST" });
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
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-400">
              <Trophy size={22} />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">
              The <span className="text-ember-400">Arcade</span>
            </span>
            <span className="ml-auto text-xs text-mute">
              {i + 1} / {STEPS.length}
            </span>
          </div>

          <div className="mt-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-400">
            <Icon size={24} />
          </div>
          <h2 className="mt-4 font-display text-2xl font-semibold text-white">{step.title}</h2>
          <p className="mt-2 min-h-[4.5rem] text-sm leading-relaxed text-mute">{step.body}</p>

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
                <Gamepad2 size={16} /> {saving ? "Entering…" : "Enter the Arcade"}
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
