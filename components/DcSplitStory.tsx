"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { CoinLogo } from "@/components/CoinLogo";
import { formatCC, formatDC } from "@/lib/format";
import {
  Split,
  Wallet,
  Gamepad2,
  Repeat,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Flame,
  Check,
} from "lucide-react";

type Step = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
};

// Informational lead-in; the final convert-or-keep choice is a separate view.
const STEPS: Step[] = [
  {
    icon: Split,
    title: "CC and DC are splitting up",
    body: "We're making the two coins simple: each one now has a single, clear job — no more exchange-rate math just to come out ahead.",
  },
  {
    icon: Wallet,
    title: "CC is your real money",
    body: "Every trade, transfer and balance runs on CC — the whole real economy, exactly as before.",
  },
  {
    icon: Gamepad2,
    title: "DC is just for play",
    body: "Mine it, win it in the Arcade, and spend it on game tiers and pack unlocks. From now on DC never converts to CC — it's pure fun.",
  },
];

type Quote = { dcBalance: number; ccQuote: number; perDc: number };

/**
 * One-time DC/CC split migration. Shows once for members who held DC before the
 * split (gated on member.dcSplitSeenAt); a final step lets them convert ALL their
 * DC to CC at today's rate or keep it for the Arcade. Either choice stamps the flag.
 */
export function DcSplitStory() {
  const { member, authedFetch, refresh } = useAuth();
  const [i, setI] = useState(0);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState<null | "convert" | "keep">(null);
  const [dismissed, setDismissed] = useState(false);

  const show = !!member && !member.dcSplitSeenAt && !dismissed;

  // Load the full-balance quote once the story is shown.
  useEffect(() => {
    if (!show) return;
    let alive = true;
    (async () => {
      try {
        const res = await authedFetch("/api/onboard/convert");
        const d = await res.json();
        if (alive) {
          setQuote({
            dcBalance: d.dcBalance ?? 0,
            ccQuote: d.ccQuote ?? 0,
            perDc: d.perDc ?? 0,
          });
        }
      } catch {
        if (alive) setQuote({ dcBalance: member?.dcBalance ?? 0, ccQuote: 0, perDc: 0 });
      }
    })();
    return () => {
      alive = false;
    };
  }, [show, authedFetch, member?.dcBalance]);

  if (!show) return null;

  const onChoice = async (choice: "convert" | "keep") => {
    setBusy(choice);
    try {
      await authedFetch("/api/onboard/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice }),
      });
      await refresh();
    } catch {
      /* even if the write fails, don't trap the member behind the modal */
    }
    setDismissed(true);
  };

  const total = STEPS.length + 1; // info steps + the final choice
  const onChoiceStep = i >= STEPS.length;
  const step = onChoiceStep ? null : STEPS[i];
  const Icon = step?.icon;
  const dc = quote?.dcBalance ?? member?.dcBalance ?? 0;
  const hasDc = dc > 0;

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm">
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
              The <span className="text-ember-400">Split</span>
            </span>
            <span className="ml-auto text-xs text-mute">
              {Math.min(i + 1, total)} / {total}
            </span>
          </div>

          {step && Icon ? (
            <>
              <div className="mt-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-400">
                <Icon size={24} />
              </div>
              <h2 className="mt-4 font-display text-2xl font-semibold text-white">
                {step.title}
              </h2>
              <p className="mt-2 min-h-[4.5rem] text-sm leading-relaxed text-mute">
                {step.body}
              </p>
            </>
          ) : (
            <>
              <div className="mt-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-400">
                <Repeat size={24} />
              </div>
              <h2 className="mt-4 font-display text-2xl font-semibold text-white">
                One last conversion — your call
              </h2>
              {hasDc ? (
                <>
                  <p className="mt-2 text-sm leading-relaxed text-mute">
                    Because DC won&apos;t convert anymore, here&apos;s your single, final chance:
                    turn all your DC into CC at today&apos;s rate, or keep it for the Arcade.
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-3 rounded-2xl border border-ember-500/25 bg-ember-500/5 p-4 text-center">
                    <span className="inline-flex items-center gap-1.5 text-lg font-semibold text-ember-300">
                      <DarkCoinLogo size={18} /> {formatDC(dc)} DC
                    </span>
                    <ArrowRight size={18} className="text-mute" />
                    <span className="inline-flex items-center gap-1.5 text-lg font-semibold text-gold-300">
                      <CoinLogo size={16} /> {quote ? `≈ ${formatCC(quote.ccQuote)}` : "…"} CC
                    </span>
                  </div>
                </>
              ) : (
                <p className="mt-2 min-h-[4.5rem] text-sm leading-relaxed text-mute">
                  You have no DC right now, so there&apos;s nothing to convert. From here on
                  you&apos;ll earn DC by mining and playing, and spend it in the Arcade.
                </p>
              )}
            </>
          )}

          {/* progress dots */}
          <div className="mt-5 flex gap-1.5">
            {Array.from({ length: total }).map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all ${
                  n === Math.min(i, total - 1) ? "w-6 bg-ember-500" : "w-1.5 bg-white/15"
                }`}
              />
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              className="btn-ghost dc-ring"
              onClick={() => setI((n) => Math.max(0, n - 1))}
              disabled={i === 0 || busy !== null}
            >
              <ArrowLeft size={16} /> Back
            </button>

            {!onChoiceStep ? (
              <button className="btn-ember dc-ring" onClick={() => setI((n) => n + 1)}>
                Next <ArrowRight size={16} />
              </button>
            ) : hasDc ? (
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost dc-ring"
                  onClick={() => onChoice("keep")}
                  disabled={busy !== null}
                >
                  {busy === "keep" ? <Loader2 size={16} className="animate-spin" /> : null}
                  Keep my DC
                </button>
                <button
                  className="btn-ember dc-ring"
                  onClick={() => onChoice("convert")}
                  disabled={busy !== null}
                >
                  {busy === "convert" ? <Loader2 size={16} className="animate-spin" /> : <Flame size={16} />}
                  Convert all to CC
                </button>
              </div>
            ) : (
              <button
                className="btn-ember dc-ring"
                onClick={() => onChoice("keep")}
                disabled={busy !== null}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Got it
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
