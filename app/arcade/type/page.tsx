"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { GameIntroModal, type TierOption } from "@/components/GameIntroModal";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { emitLedgerChange } from "@/lib/ledgerEvents";
import { formatDC } from "@/lib/format";
import type { ArcadeStatus, TypeStart, TypeSubmitResult } from "@/lib/types";
import { toast } from "sonner";
import { Keyboard, Loader2, Timer, Gauge, Trophy, ArrowRight } from "lucide-react";

const DIFF_LABEL: Record<number, string> = {
  5: "Hardest",
  4: "Hard",
  3: "Medium",
  2: "Easier",
  1: "Easiest",
};

type Race = { sessionId: string; tier: number; text: string; startedAtMs: number };

export default function ArcadeTypePage() {
  return (
    <AppShell>
      <TypeRace />
    </AppShell>
  );
}

function TypeRace() {
  const { authedFetch, refresh } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<ArcadeStatus | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [race, setRace] = useState<Race | null>(null);
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TypeSubmitResult | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const keystrokesRef = useRef(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await authedFetch("/api/arcade");
        if (!alive) return;
        setStatus((await r.json()) as ArcadeStatus);
      } catch {
        /* ignore */
      }
      if (alive) setShowIntro(true);
    })();
    return () => {
      alive = false;
    };
  }, [authedFetch]);

  // Live timer while racing.
  useEffect(() => {
    if (!race || result) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [race, result]);

  const target = race?.text ?? "";
  const correctPrefix = useMemo(() => {
    let i = 0;
    while (i < typed.length && i < target.length && typed[i] === target[i]) i++;
    return i;
  }, [typed, target]);
  const complete = typed === target && target.length > 0;

  const elapsedSec = race ? Math.max(0, (now - race.startedAtMs) / 1000) : 0;
  const liveWpm = elapsedSec > 1 ? Math.round((correctPrefix / 5 / elapsedSec) * 60) : 0;
  const progress = target.length ? Math.round((correctPrefix / target.length) * 100) : 0;

  const tiers: TierOption[] = useMemo(() => {
    const fees = status?.tierFees ?? [20, 50, 100];
    const diffs = [5, 4, 3, 2]; // free, t1, t2, t3
    const freeUsed = (status?.freeRemaining ?? 0) <= 0;
    const opts: TierOption[] = [
      {
        tier: 0,
        label: "Free",
        cost: 0,
        detail: DIFF_LABEL[diffs[0]],
        disabled: freeUsed,
        note: freeUsed ? "Free play used today" : undefined,
      },
    ];
    for (let t = 1; t <= fees.length; t++) {
      opts.push({ tier: t, label: `Tier ${t}`, cost: fees[t - 1], detail: DIFF_LABEL[diffs[t]] });
    }
    return opts;
  }, [status]);

  async function start(tier: number) {
    setStarting(true);
    setStartErr(null);
    try {
      const r = await authedFetch("/api/arcade/type", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", tier }),
      });
      const d = await r.json();
      if (!r.ok) {
        setStartErr(d.message || "Couldn't start the race.");
        return;
      }
      const s = d as TypeStart;
      keystrokesRef.current = 0;
      setTyped("");
      setResult(null);
      setRace({ sessionId: s.sessionId, tier: s.tier, text: s.text, startedAtMs: s.startedAtMs });
      setShowIntro(false);
      setNow(Date.now());
      void refresh();
      setTimeout(() => taRef.current?.focus(), 50);
    } catch {
      setStartErr("Network error — try again.");
    } finally {
      setStarting(false);
    }
  }

  const submit = useCallback(
    async (finalText: string) => {
      if (!race || submitting) return;
      setSubmitting(true);
      try {
        const r = await authedFetch("/api/arcade/type", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "submit",
            sessionId: race.sessionId,
            text: finalText,
            keystrokes: keystrokesRef.current || finalText.length,
          }),
        });
        const d = await r.json();
        if (!r.ok) {
          toast.error(d.message || "Submit failed.");
          return;
        }
        const res = d as TypeSubmitResult;
        setResult(res);
        toast.success(res.minted > 0 ? `+${formatDC(res.minted)} DC · ${res.wpm} WPM 🔥` : `${res.wpm} WPM — no reward this time.`);
        void refresh();
        emitLedgerChange();
      } catch {
        toast.error("Network error — try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [authedFetch, race, refresh, submitting],
  );

  // Auto-submit the instant the paragraph matches exactly.
  useEffect(() => {
    if (complete && race && !result && !submitting) void submit(typed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

  if (!race && !showIntro) {
    return (
      <div className="flex h-72 items-center justify-center text-mute">
        <Loader2 className="animate-spin text-ember-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="text-center">
        <h1 className="flex items-center justify-center gap-2 font-display text-2xl font-bold text-white">
          <Keyboard size={22} className="text-ember-400" /> Type Racing
        </h1>
        <p className="mt-1 text-sm text-mute">Type the passage exactly — fix every red letter. Faster = more DC.</p>
      </div>

      {showIntro && (
        <GameIntroModal
          title="Type Racing"
          icon={<Keyboard size={22} />}
          intro="Type the passage as fast as you can. Wrong letters turn red and must be fixed — you finish only when every character matches."
          rules={[
            "Reward scales with your speed: 100+ WPM = 100 DC, 90+ = 50, 80+ = 25, 70+ = 12.5 …",
            "Accuracy earns no bonus, but mistakes cost you time. Pasting is disabled.",
            "Higher tiers give easier passages. Backing out here costs nothing.",
          ]}
          tiers={tiers}
          busy={starting}
          error={startErr}
          onContinue={start}
          onBack={() => router.push("/arcade")}
        />
      )}

      {race && !result && (
        <>
          <div className="dc-card flex items-center justify-around p-4 text-center">
            <Metric icon={<Timer size={15} />} label="Time" value={`${Math.floor(elapsedSec)}s`} />
            <Metric icon={<Gauge size={15} />} label="WPM" value={String(liveWpm)} ember />
            <Metric label="Progress" value={`${progress}%`} />
          </div>

          <div
            className="dc-card cursor-text p-5 leading-relaxed"
            onClick={() => taRef.current?.focus()}
          >
            <p className="whitespace-pre-wrap break-words font-mono text-[15px]">
              {target.split("").map((ch, i) => {
                let cls = "text-mute/60"; // pending
                if (i < typed.length) cls = typed[i] === ch ? "text-teal-300" : "bg-red-500/30 text-red-200 rounded-sm";
                const cursor = i === typed.length ? " border-l-2 border-ember-400" : "";
                return (
                  <span key={i} className={`${cls}${cursor}`}>
                    {ch}
                  </span>
                );
              })}
            </p>
            <textarea
              ref={taRef}
              value={typed}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="absolute h-0 w-0 opacity-0"
              aria-label="Type the passage here"
              onPaste={(e) => {
                e.preventDefault();
                toast.error("Pasting is disabled.");
              }}
              onDrop={(e) => e.preventDefault()}
              onChange={(e) => {
                const v = e.target.value;
                if (v.length > target.length) return; // no overflow past the passage
                if (v.length > typed.length) keystrokesRef.current += v.length - typed.length;
                setTyped(v);
              }}
            />
          </div>

          <p className="text-center text-xs text-mute">
            Click the passage if the keyboard doesn&apos;t respond. Submitting is automatic once it matches.
          </p>
        </>
      )}

      {result && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm">
          <div className="dc-card animate-cap-slam w-full max-w-sm p-7 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-300">
              <Trophy size={28} />
            </div>
            <h2 className="mt-4 font-display text-2xl font-semibold text-white">
              {result.wpm} WPM
            </h2>
            <p className="mt-1 text-sm text-mute">{result.accuracy}% accuracy · {result.elapsedSec}s</p>
            <div className="mt-4 flex items-center justify-center gap-2 font-display text-3xl font-bold text-gradient-flame">
              <DarkCoinLogo size={26} /> +{formatDC(result.minted)} DC
            </div>
            <div className="mt-6 flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => router.push("/arcade")}>
                Arcade
              </button>
              <button
                className="btn-ember flex-1"
                onClick={() => {
                  setResult(null);
                  setRace(null);
                  void (async () => {
                    const r = await authedFetch("/api/arcade");
                    setStatus((await r.json()) as ArcadeStatus);
                    setShowIntro(true);
                  })();
                }}
              >
                Race again <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  ember,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  ember?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-xs text-mute">
        {icon} {label}
      </div>
      <div className={`mt-0.5 font-display text-xl font-bold ${ember ? "text-ember-300" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}
