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

  // Get-ready breather: startedAtMs is set in the FUTURE, so the clock and typing
  // only begin once `now` passes it. Until then we show a countdown over the passage.
  const armed = race ? now >= race.startedAtMs : true;
  const countdownLeft = race ? Math.max(0, Math.ceil((race.startedAtMs - now) / 1000)) : 0;
  // Current-word error: the typed text isn't a prefix of the target word (a wrong
  // letter), or it runs past the word's end. Drives the red input box + red word —
  // the mistyped characters stay in the INPUT, so the passage never shifts.
  const curWord = words[wi] ?? "";
  const curError = cur.length > 0 && (!curWord.startsWith(cur) || cur.length > curWord.length);

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

  // A real, visible input holds only the CURRENT WORD. Typing + backspace flow
  // through onChange naturally; we special-case space (advance only once the word is
  // exactly right) and Ctrl/Cmd+Backspace (wipe the current word, never the locked-in
  // ones). Space is handled in onChange so it also works where keydown can't be
  // prevented (mobile / IME). Completed words stay locked because the box clears on
  // advance — you can't backspace into a previous word.
  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (submitting || complete || !race) return;
      let v = e.currentTarget.value;
      if (v.includes(" ")) {
        const attempt = v.slice(0, v.indexOf(" ")); // what was typed before the space
        if (attempt === words[wi] && wi < lastIdx) {
          keystrokesRef.current += 1;
          setWi(wi + 1);
          setCur("");
          return;
        }
        v = v.replace(/ /g, ""); // not a valid advance — drop the space, keep the word
      }
      if (v.length > cur.length) keystrokesRef.current += v.length - cur.length;
      setCur(v);
    },
    [submitting, complete, race, cur, words, wi, lastIdx],
  );

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!race || submitting || complete) return;
      if (Date.now() < race.startedAtMs) {
        e.preventDefault(); // still in the get-ready countdown
        return;
      }
      if ((e.ctrlKey || e.metaKey || e.altKey) && e.key === "Backspace") {
        e.preventDefault();
        setCur(""); // clear the current word only
      }
    },
    [race, submitting, complete],
  );

  // The input is disabled during the countdown; focus it the instant it arms.
  useEffect(() => {
    if (race && armed && !result && !submitting) inputRef.current?.focus();
  }, [race, armed, result, submitting]);

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
          Type each word in the box — the passage turns green as you go. Faster = more DC.
        </p>
      </div>

      {showIntro && (
        <GameIntroModal
          title="Type Racing"
          icon={<Keyboard size={22} />}
          intro="Type the passage into the box below it, one word at a time. Each word you finish turns green; the box turns red on a wrong letter and won't advance until it matches."
          rules={[
            "A 5-second get-ready countdown lets you read the passage first — the clock starts at zero.",
            "Type into the box beneath the passage; press space to lock each word in green. A wrong letter reddens the box and the word, and you can't move on until it's right.",
            "The faster and cleaner you type, the more DC you earn. Pasting is disabled.",
            "Higher tiers give easier passages plus free re-attempts — restart mid-race or chase a better score.",
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
            {armed ? (
              <>
                <Metric icon={<Timer size={15} />} label="Time" value={`${Math.floor(elapsedSec)}s`} />
                <Metric icon={<Gauge size={15} />} label="WPM" value={String(liveWpm)} ember />
                <Metric label="Progress" value={`${progress}%`} />
                {race.reAttemptsLeft > 0 && (
                  <Metric icon={<RotateCcw size={15} />} label="Retries" value={String(race.reAttemptsLeft)} />
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[11px] uppercase tracking-widest text-mute">
                  Get ready · read the passage
                </span>
                <span className="font-display text-4xl font-bold tabular-nums text-ember-300">
                  {countdownLeft}
                </span>
              </div>
            )}
          </div>

          {/* Passage — STATIC: only colours change as you type, characters never move.
              Mistyped/overrun text lives in the input box below, so this can't shift. */}
          <div className="dc-card cursor-text p-5 leading-relaxed" onClick={() => inputRef.current?.focus()}>
            <p className="whitespace-pre-wrap break-words font-mono text-[15px]">
              {tokens.map((tk, i) => {
                const before = target.slice(
                  i === 0 ? 0 : tokens[i - 1].start + tokens[i - 1].word.length,
                  tk.start,
                );
                const sep = before ? (
                  <span key={`s${i}`} className={i <= wi || complete ? "text-emerald-400" : "text-mute/40"}>
                    {before}
                  </span>
                ) : null;
                let node: React.ReactNode;
                if (i < wi || complete) {
                  // Completed → green. `complete` flips the whole passage green the
                  // instant the last word matches, so it reads as done during the
                  // (brief) submit round-trip before the results overlay appears.
                  node = <span className="text-emerald-400">{tk.word}</span>;
                } else if (i === wi) {
                  node = curError ? (
                    <span className="rounded bg-red-500/25 text-red-200 underline decoration-red-400/70 underline-offset-2">
                      {tk.word}
                    </span>
                  ) : (
                    <span className="underline decoration-white/30 underline-offset-2">
                      <span className="text-white">{tk.word.slice(0, cur.length)}</span>
                      <span className="text-mute">{tk.word.slice(cur.length)}</span>
                    </span>
                  );
                } else {
                  node = <span className="text-mute">{tk.word}</span>; // not yet typed
                }
                return (
                  <span key={`w${i}`}>
                    {sep}
                    {node}
                  </span>
                );
              })}
            </p>
          </div>

          {/* Dedicated input (typeracer-style): holds the current word; turns soft-red
              on a mistype. Errors never touch the passage layout above. */}
          <input
            ref={inputRef}
            type="text"
            value={cur}
            onChange={onInputChange}
            onKeyDown={onInputKeyDown}
            disabled={!armed || submitting || complete}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            inputMode="text"
            aria-label="Type the passage here"
            placeholder={armed ? "Type the passage here…" : "Get ready — the race is about to start"}
            onPaste={(e) => {
              e.preventDefault();
              toast.error("Pasting is disabled.");
            }}
            onDrop={(e) => e.preventDefault()}
            className={`w-full rounded-xl border px-4 py-3 font-mono text-[15px] outline-none transition-colors disabled:opacity-60 ${
              curError
                ? "border-red-500/60 bg-red-500/15 text-red-100 placeholder:text-red-200/40"
                : "border-white/15 bg-black/30 text-white placeholder:text-mute/50 focus:border-ember-500/60"
            }`}
          />

          <p className="text-center text-xs text-mute">
            Type each word and press space to lock it in green. Ctrl+Backspace clears the current word.
          </p>

          {race.reAttemptsLeft > 0 && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={reattempt}
                disabled={reattempting}
                className="btn-ghost inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
                title="Start over with a fresh passage — spends one re-attempt"
              >
                {reattempting ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RotateCcw size={15} />
                )}
                Restart · {race.reAttemptsLeft} left
              </button>
            </div>
          )}
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
