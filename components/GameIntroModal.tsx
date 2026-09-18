"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Check } from "lucide-react";
import { formatCC } from "@/lib/format";

export type TierOption = {
  tier: number; // 0 = free, 1..3 = paid
  label: string; // e.g. "Free", "Tier 1"
  cost: number; // CC fee (0 for free)
  detail: string; // e.g. "3 words"
  disabled?: boolean;
  note?: string; // why it's disabled, or an extra hint
};

/**
 * The pre-game instructions popup (shown before every game). Explains the rules
 * and lets the player pick a tier. "Enter" spends the play and starts; "Back"
 * costs nothing and returns to the arcade.
 */
export function GameIntroModal({
  title,
  icon,
  intro,
  rules,
  tiers,
  defaultTier = 0,
  busy = false,
  error = null,
  onContinue,
  onBack,
}: {
  title: string;
  icon: React.ReactNode;
  intro: string;
  rules: string[];
  tiers: TierOption[];
  defaultTier?: number;
  busy?: boolean;
  error?: string | null;
  onContinue: (tier: number) => void;
  onBack: () => void;
}) {
  const firstEnabled = tiers.find((t) => !t.disabled)?.tier ?? 0;
  const initial = tiers.find((t) => t.tier === defaultTier && !t.disabled)
    ? defaultTier
    : firstEnabled;
  const [tier, setTier] = useState(initial);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm">
      <div className="dc-card animate-cap-slam relative w-full max-w-lg overflow-hidden p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-ember-500/20 blur-3xl"
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-400">
              {icon}
            </div>
            <h2 className="font-display text-xl font-semibold text-white">{title}</h2>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-mute">{intro}</p>

          <ul className="mt-4 space-y-2">
            {rules.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm text-mute">
                <Check size={15} className="mt-0.5 shrink-0 text-teal-400" />
                <span>{r}</span>
              </li>
            ))}
          </ul>

          {tiers.length > 0 && (
            <div className="mt-5">
              <div className="text-xs uppercase tracking-wider text-mute">Choose a tier</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {tiers.map((t) => {
                  const active = t.tier === tier;
                  return (
                    <button
                      key={t.tier}
                      disabled={t.disabled}
                      onClick={() => setTier(t.tier)}
                      className={`rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        active
                          ? "border-ember-500/60 bg-ember-500/10 shadow-glow-ember"
                          : "border-edge bg-ink-800/50 hover:border-ember-500/30"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white">{t.label}</span>
                        <span className="text-xs text-ember-300">
                          {t.cost > 0 ? `${formatCC(t.cost)} CC` : "Free"}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-mute">{t.detail}</div>
                      {t.note && <div className="mt-1 text-[11px] text-mute/80">{t.note}</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <button className="btn-ghost dc-ring" onClick={onBack} disabled={busy}>
              <ArrowLeft size={16} /> Back
            </button>
            <button
              className="btn-ember dc-ring"
              onClick={() => onContinue(tier)}
              disabled={busy}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {busy ? "Starting…" : "Enter game"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
