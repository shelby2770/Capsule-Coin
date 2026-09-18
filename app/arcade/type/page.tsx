"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { GameIntroModal, type TierOption } from "@/components/GameIntroModal";
import { Portal } from "@/components/Portal";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { emitLedgerChange } from "@/lib/ledgerEvents";
import { formatDC } from "@/lib/format";
import type { ArcadeStatus, TypeStart, TypeSubmitResult } from "@/lib/types";
import { toast } from "sonner";
import { Keyboard, Loader2, Timer, Gauge, Trophy, ArrowRight, RotateCcw } from "lucide-react";

const DIFF_LABEL: Record<number, string> = {
  5: "Hardest",
  4: "Hard",
  3: "Medium",
  2: "Easier",
  1: "Easiest",
};
// Free re-attempts per tier [free, t1, t2, t3] — mirrors config.games.type.reAttempts.
const REATTEMPTS = [0, 1, 2, 3];

type Race = {
  sessionId: string;
  tier: number;
  text: string;
  startedAtMs: number;
  reAttemptsLeft: number;
};
type Token = { word: string; start: number };

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
  // Word-by-word (typeracer-style): `wi` is the current word index; `cur` is what
  // the racer has typed for that word. Completed words are locked in — you can't
  // advance past a word until it exactly matches.
  const [wi, setWi] = useState(0);
  const [cur, setCur] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reattempting, setReattempting] = useState(false);
  const [result, setResult] = useState<TypeSubmitResult | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const keystrokesRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

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
  // Split the paragraph into word tokens (with their start offset), so completed
  // text is always an exact prefix of the target regardless of the spacing.
  const tokens: Token[] = useMemo(() => {
    const out: Token[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(target))) out.push({ word: m[0], start: m.index });
    return out;
  }, [target]);
  const words = useMemo(() => tokens.map((t) => t.word), [tokens]);

  const lastIdx = words.length - 1;
  const complete = words.length > 0 && wi === lastIdx && cur === words[lastIdx];
  // Chars confirmed correct = everything up to the current word, plus the current
  // word's correctly-typed prefix. Drives live WPM + progress.
  const curOk = wi <= lastIdx && words[wi] ? words[wi].startsWith(cur) : false;
  const correctChars = (tokens[wi]?.start ?? target.length) + (curOk ? cur.length : 0);

  const elapsedSec = race ? Math.max(0, (now - race.startedAtMs) / 1000) : 0;
  const liveWpm = elapsedSec > 1 ? Math.round((correctChars / 5 / elapsedSec) * 60) : 0;
  const progress = target.length ? Math.round((correctChars / target.length) * 100) : 0;

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
        note: freeUsed ? "Free play used today" : "No re-attempts",
      },
    ];
    for (let t = 1; t <= fees.length; t++) {
      const n = REATTEMPTS[t] ?? 0;
      opts.push({
        tier: t,
        label: `Tier ${t}`,
        cost: fees[t - 1],
        detail: DIFF_LABEL[diffs[t]],
        note: `${n} free re-attempt${n === 1 ? "" : "s"}`,
      });
    }
    return opts;
  }, [status]);

  const resetRace = useCallback((s: TypeStart) => {
    keystrokesRef.current = 0;
    setWi(0);
    setCur("");
    setResult(null);
    setRace({
      sessionId: s.sessionId,
      tier: s.tier,
      text: s.text,
      startedAtMs: s.startedAtMs,
      reAttemptsLeft: s.reAttemptsLeft,
    });
    setNow(Date.now());
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

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
      setShowIntro(false);
      resetRace(d as TypeStart);
      void refresh();
    } catch {
      setStartErr("Network error — try again.");
    } finally {
      setStarting(false);
    }
  }

  async function reattempt() {
    if (!race || reattempting) return;
    setReattempting(true);
    try {
      const r = await authedFetch("/api/arcade/type", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reattempt", sessionId: race.sessionId }),
      });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.message || "Couldn't re-attempt.");
        return;
      }
      resetRace(d as TypeStart);
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setReattempting(false);
    }
  }

  function raceAgain() {
    setResult(null);
    setRace(null);
    void (async () => {
      const r = await authedFetch("/api/arcade");
      setStatus((await r.json()) as ArcadeStatus);
      setShowIntro(true);
    })();
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
        if (res.improved) {
          toast.success(`+${formatDC(res.minted)} DC · ${res.wpm} WPM 🔥`);
        } else if (res.reAttemptsLeft > 0) {
          toast(
            `${res.wpm} WPM — no gain on your best. ${res.reAttemptsLeft} re-attempt${
              res.reAttemptsLeft === 1 ? "" : "s"
            } left.`,
          );
        } else {
          toast(
            res.totalReward > 0
              ? `${res.wpm} WPM — kept your best ${formatDC(res.totalReward)} DC.`
              : `${res.wpm} WPM — no reward this time.`,
          );
        }
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

  // Auto-submit the instant the final word is typed correctly.
  useEffect(() => {
    if (complete && race && !result && !submitting) void submit(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

  // Keyboard: drive the current-word buffer ourselves so we control advancing
  // (space only moves on once the word is exactly right) and Ctrl+Backspace
  // (clears the current word only — never the locked-in previous words).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (submitting || complete || !race) return;
      const k = e.key;
      if (k === "Backspace") {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey || e.altKey) setCur(""); // clear the current word only
        else setCur((c) => c.slice(0, -1));
        return;
      }
      if (k === " " || k === "Spacebar") {
        e.preventDefault();
        // Advance only when the current word matches exactly; otherwise it stays
        // put (a wrong/half-typed word can't be skipped).
        if (cur === words[wi] && wi < lastIdx) {
          keystrokesRef.current += 1;
          setWi(wi + 1);
          setCur("");
        }
        return;
      }
      if (k === "Enter") {
        e.preventDefault();
        return;
      }
      if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        keystrokesRef.current += 1;
        setCur((c) => c + k);
      }
    },
    [submitting, complete, race, cur, words, wi, lastIdx],
  );

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
        <p className="mt-1 text-sm text-mute">
          Type it word by word — a word stays red until it&apos;s right. Faster = more DC.
        </p>
      </div>

      {showIntro && (
        <GameIntroModal
          title="Type Racing"
          icon={<Keyboard size={22} />}
          intro="Type the passage as fast as you can, one word at a time. A word stays red until every letter is right, and you can't move on until it matches."
          rules={[
            "You advance word by word — the current word turns red if any letter is wrong, and space only moves on once it's exactly right.",
            "The faster and cleaner you type, the more DC you earn. Pasting is disabled.",
            "Higher tiers give easier passages and free re-attempts to beat your best. Backing out here costs nothing.",
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
            {race.reAttemptsLeft > 0 && (
              <Metric icon={<RotateCcw size={15} />} label="Retries" value={String(race.reAttemptsLeft)} />
            )}
          </div>

          <div className="dc-card cursor-text p-5 leading-relaxed" onClick={() => inputRef.current?.focus()}>
            <p className="whitespace-pre-wrap break-words font-mono text-[15px]">
              {tokens.map((tk, i) => {
                const before = target.slice(i === 0 ? 0 : tokens[i - 1].start + tokens[i - 1].word.length, tk.start);
                const sep = before ? (
                  <span key={`s${i}`} className="whitespace-pre-wrap text-mute/40">
                    {before}
                  </span>
                ) : null;
                return (
                  <span key={`w${i}`}>
                    {sep}
                    <WordSpan word={tk.word} mode={i < wi ? "done" : i === wi ? "current" : "pending"} cur={cur} />
                  </span>
                );
              })}
            </p>
            <input
              ref={inputRef}
              value={cur}
              onChange={() => {}}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              inputMode="text"
              className="absolute h-0 w-0 opacity-0"
              aria-label="Type the passage here"
              onPaste={(e) => {
                e.preventDefault();
                toast.error("Pasting is disabled.");
              }}
              onDrop={(e) => e.preventDefault()}
            />
          </div>

          <p className="text-center text-xs text-mute">
            Click the passage if the keyboard doesn&apos;t respond. Ctrl+Backspace clears the current word.
          </p>
        </>
      )}

      {result && (
        <Portal>
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm">
            <div className="dc-card animate-cap-slam w-full max-w-sm p-7 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-300">
                <Trophy size={28} />
              </div>
              <h2 className="mt-4 font-display text-2xl font-semibold text-white">{result.wpm} WPM</h2>
              <p className="mt-1 text-sm text-mute">
                {result.accuracy}% accuracy · {result.elapsedSec}s
                {result.bestWpm > result.wpm ? ` · best ${result.bestWpm} WPM` : ""}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2 font-display text-3xl font-bold text-gradient-flame">
                <DarkCoinLogo size={26} /> +{formatDC(result.totalReward)} DC
              </div>
              <p className="mt-1 text-xs text-mute">
                {result.improved
                  ? `New best — +${formatDC(result.minted)} DC this run`
                  : result.reAttemptsLeft > 0
                    ? "No gain this run — your best stands"
                    : "Entry complete"}
              </p>
              <div className="mt-6 flex gap-2">
                <button className="btn-ghost flex-1" onClick={() => router.push("/arcade")}>
                  Arcade
                </button>
                {result.reAttemptsLeft > 0 ? (
                  <button className="btn-ember flex-1" onClick={reattempt} disabled={reattempting}>
                    {reattempting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                    Re-attempt · {result.reAttemptsLeft} left
                  </button>
                ) : (
                  <button className="btn-ember flex-1" onClick={raceAgain}>
                    Race again <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

/** One word in the passage: locked-in (teal), current (typed + caret, or all-red
 *  on any wrong letter), or pending (muted). */
function WordSpan({ word, mode, cur }: { word: string; mode: "done" | "current" | "pending"; cur: string }) {
  if (mode === "done") {
    return <span className="text-teal-300">{word}</span>;
  }
  if (mode === "pending") {
    return <span className="text-mute/50">{word}</span>;
  }
  // current word
  const wrong = !word.startsWith(cur) || cur.length > word.length;
  if (wrong) {
    return <span className="rounded-sm bg-red-500/25 text-red-300">{word}</span>;
  }
  return (
    <span className="rounded-sm bg-ember-500/10 ring-1 ring-ember-500/25">
      {word.split("").map((ch, j) => (
        <span
          key={j}
          className={`${j < cur.length ? "text-white" : "text-mute/50"} ${
            j === cur.length ? "border-l-2 border-ember-400" : ""
          }`}
        >
          {ch}
        </span>
      ))}
    </span>
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
