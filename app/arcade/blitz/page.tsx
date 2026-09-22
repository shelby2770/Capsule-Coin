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
import type { ArcadeStatus, BlitzStart, BlitzSubmitResult, GameGuardResult } from "@/lib/types";
import { toast } from "sonner";
import { Zap, Loader2, Timer, Trophy, ArrowRight, Check, X, Ban, ShieldAlert, EyeOff } from "lucide-react";

const LETTER = (i: number) => String.fromCharCode(65 + i);

export default function ArcadeBlitzPage() {
  return (
    <AppShell>
      <Blitz />
    </AppShell>
  );
}

function Blitz() {
  const { authedFetch, refresh } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<ArcadeStatus | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<BlitzStart | null>(null);
  const [idx, setIdx] = useState(0);
  const [chosen, setChosen] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BlitzSubmitResult | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [banUntil, setBanUntil] = useState(0);
  // Screenshot deterrent: true while the window is blurred / the tab is hidden — the
  // question is blurred out then, so a Snipping-Tool grab captures nothing useful.
  const [obscured, setObscured] = useState(false);

  const chosenRef = useRef<number[]>([]);
  const submittedRef = useRef(false);
  const advancingRef = useRef(false);
  const deadlineRef = useRef(0);

  const total = quiz?.questions.length ?? 0;
  const secPerQuestion = quiz?.secPerQuestion ?? 30;
  const q = quiz?.questions[idx];

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await authedFetch("/api/arcade");
        if (!alive) return;
        if (r.ok) {
          const s = (await r.json()) as ArcadeStatus;
          setStatus(s);
          if (s.bans.blitz > 0) {
            setBanUntil(s.bans.blitz); // locked out — show the ban screen, skip the intro
            return;
          }
        }
      } catch {
        /* ignore */
      }
      if (alive) setShowIntro(true);
    })();
    return () => {
      alive = false;
    };
  }, [authedFetch]);

  const submitQuiz = useCallback(
    async (answers: number[]) => {
      if (!quiz || submitting) return;
      setSubmitting(true);
      try {
        const r = await authedFetch("/api/arcade/blitz", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "submit", sessionId: quiz.sessionId, answers }),
        });
        const d = await r.json();
        if (!r.ok) {
          // End the round on failure instead of resetting and letting the timer
          // re-fire submit (which loops forever once the session is closed).
          setSubmitErr(d.message || "Couldn't score this round — please try again.");
          void refresh();
          return;
        }
        setResult(d as BlitzSubmitResult);
        void refresh();
        emitLedgerChange();
      } catch {
        setSubmitErr("Network error — this round couldn't be scored.");
      } finally {
        setSubmitting(false);
      }
    },
    [authedFetch, quiz, refresh, submitting],
  );

  // Advance to the next question, or submit after the last one.
  const advance = useCallback(() => {
    setIdx((cur) => {
      if (cur + 1 < total) return cur + 1;
      if (!submittedRef.current) {
        submittedRef.current = true;
        void submitQuiz(chosenRef.current);
      }
      return cur;
    });
  }, [total, submitQuiz]);

  // Per-question clock: reset on each question, tick the display, auto-advance at zero.
  useEffect(() => {
    if (!quiz || result || submitting || submitErr) return;
    advancingRef.current = false;
    setLocked(false);
    deadlineRef.current = Date.now() + secPerQuestion * 1000;
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= deadlineRef.current && !advancingRef.current) {
        advancingRef.current = true;
        advance();
      }
    }, 200);
    return () => clearInterval(id);
  }, [quiz, idx, result, submitting, submitErr, secPerQuestion, advance]);

  // Copy/screenshot guard — copying a question to feed an LLM is the cheat, so any
  // attempt bans the member from AI Blitz (this game only) for a few days and
  // abandons the round. Best-effort + client-driven; the ban decision is
  // authoritative server-side.
  const reportGuard = useCallback(async () => {
    if (!quiz) return;
    try {
      const r = await authedFetch("/api/arcade/blitz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "guard", sessionId: quiz.sessionId }),
      });
      if (!r.ok) return;
      const d = (await r.json()) as GameGuardResult;
      if (d.banned) {
        setBanUntil(d.banUntilMs);
        setQuiz(null);
      }
    } catch {
      /* best-effort */
    }
  }, [authedFetch, quiz]);

  const onCopyAttempt = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      toast.error("Copying the question is disabled — and monitored.");
      void reportGuard();
    },
    [reportGuard],
  );

  // Screenshot deterrent (no ban): blur the question whenever the window loses focus
  // or the tab is hidden — the Snipping Tool's overlay steals focus, so a grab then
  // captures a blurred question. Losing focus isn't proof of anything, so no ban.
  useEffect(() => {
    if (!quiz || result || submitErr) return;
    const hide = () => setObscured(true);
    const show = () => setObscured(false);
    const onVis = () => (document.hidden ? hide() : show());
    window.addEventListener("blur", hide);
    window.addEventListener("focus", show);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", show);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [quiz, result, submitErr]);

  // PrtScn ban. Windows browsers surface the PrtScn keyup (only the keyup, and only
  // the physical key — never Win+Shift+S, macOS, or a phone). The capture already
  // happened, so this is retaliation: the instant we see it, we lock the member out.
  useEffect(() => {
    if (!quiz || result || submitErr) return;
    let sent = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "PrintScreen" || sent) return;
      sent = true;
      toast.error("Screenshot detected — you're locked out of AI Blitz.");
      void reportGuard();
    };
    window.addEventListener("keyup", onKey);
    return () => window.removeEventListener("keyup", onKey);
  }, [quiz, result, submitErr, reportGuard]);

  function pick(opt: number) {
    if (advancingRef.current || locked || result || submitting) return;
    advancingRef.current = true;
    setLocked(true);
    setChosen((prev) => {
      const n = [...prev];
      n[idx] = opt;
      chosenRef.current = n;
      return n;
    });
    const wasLast = idx + 1 >= total;
    setTimeout(() => {
      if (wasLast) {
        if (!submittedRef.current) {
          submittedRef.current = true;
          void submitQuiz(chosenRef.current);
        }
      } else {
        setIdx((cur) => cur + 1);
      }
    }, 350);
  }

  const tiers: TierOption[] = useMemo(() => {
    const freeUsed = (status?.freeRemaining ?? 0) <= 0;
    return [
      {
        tier: 0,
        label: "Free",
        cost: 0,
        detail: "Rapid MCQs",
        disabled: freeUsed,
        note: freeUsed ? "Free play used today" : "Free tier only",
      },
    ];
  }, [status]);

  async function start() {
    setStarting(true);
    setStartErr(null);
    try {
      const r = await authedFetch("/api/arcade/blitz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", tier: 0 }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.error === "GAME_BANNED") setBanUntil(Date.now() + 1); // trigger the banned screen
        setStartErr(d.message || "Couldn't start the quiz.");
        return;
      }
      const s = d as BlitzStart;
      const blank = new Array(s.questions.length).fill(-1);
      chosenRef.current = blank;
      submittedRef.current = false;
      advancingRef.current = false;
      setChosen(blank);
      setIdx(0);
      setResult(null);
      setSubmitErr(null);
      setQuiz(s);
      setShowIntro(false);
      void refresh();
    } catch {
      setStartErr("Network error — try again.");
    } finally {
      setStarting(false);
    }
  }

  function playAgain() {
    setResult(null);
    setSubmitErr(null);
    submittedRef.current = false;
    setQuiz(null);
    void (async () => {
      const r = await authedFetch("/api/arcade");
      if (r.ok) setStatus((await r.json()) as ArcadeStatus);
      setShowIntro(true);
    })();
  }

  const secLeft = Math.max(0, Math.ceil((deadlineRef.current - now) / 1000));
  const barPct = Math.max(0, Math.min(100, ((deadlineRef.current - now) / (secPerQuestion * 1000)) * 100));

  // ── render ──────────────────────────────────────────────────────────────────
  if (banUntil > 0) {
    return (
      <div className="mx-auto max-w-md">
        <div className="dc-card mt-10 p-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/15 text-red-300">
            <Ban size={28} />
          </div>
          <h1 className="mt-4 font-display text-2xl font-semibold text-white">Locked out</h1>
          <p className="mt-2 text-sm text-mute">
            You&apos;re banned from AI Blitz for copying or screenshotting a question. Access returns on
          </p>
          <p className="mt-1 font-semibold text-white">{new Date(banUntil).toUTCString()}</p>
          <p className="mt-2 text-xs text-mute">
            This affects AI Blitz only — your account and the other games are unaffected.
          </p>
          <button className="btn-ember mt-6 w-full" onClick={() => router.push("/arcade")}>
            Back to Arcade
          </button>
        </div>
      </div>
    );
  }

  if (!quiz && !showIntro) {
    return (
      <div className="flex h-72 items-center justify-center text-mute">
        <Loader2 className="animate-spin text-ember-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="text-center">
        <h1 className="flex items-center justify-center gap-2 font-display text-2xl font-bold text-white">
          <Zap size={22} className="text-ember-400" /> AI Blitz
        </h1>
        <p className="mt-1 text-sm text-mute">
          Rapid-fire AI/ML questions — think fast, the clock waits for no one.
        </p>
      </div>

      {showIntro && (
        <GameIntroModal
          title="AI Blitz"
          icon={<Zap size={22} />}
          intro="A rapid-fire round of multiple-choice questions on recent AI/ML — LangChain, LangGraph, LangSmith, RAG, agents, and AI-assisted software engineering."
          rules={[
            "5 questions, 30 seconds each — pick an answer and it locks in, with no going back.",
            "If the timer runs out on a question, it counts as unanswered.",
            "Each correct answer forges 1 DC, and it's free to play.",
            "Copying a question or taking a screenshot locks you out of this game for 3 days — answer from what you know.",
          ]}
          tiers={tiers}
          busy={starting}
          error={startErr}
          onContinue={() => void start()}
          onBack={() => router.push("/arcade")}
        />
      )}

      {quiz && !result && !submitErr && q && (
        <>
          <div className="dc-card p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-mute">
                Question <span className="font-semibold text-white">{idx + 1}</span>
                <span className="text-mute">/{total}</span>
              </span>
              <span
                className={`inline-flex items-center gap-1 tabular-nums ${
                  secLeft <= 5 ? "text-ember-300" : "text-mute"
                }`}
              >
                <Timer size={14} /> {secLeft}s
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className={`h-full rounded-full transition-[width] duration-200 ease-linear ${
                  secLeft <= 5 ? "bg-ember-500" : "bg-gradient-to-r from-teal-400 to-ember-500"
                }`}
                style={{ width: `${barPct}%` }}
              />
            </div>
          </div>

          <div
            className="dc-card select-none p-5"
            onCopy={onCopyAttempt}
            onCut={onCopyAttempt}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-mute">
              <ShieldAlert size={13} className="text-ember-400" /> Copy- &amp; screenshot-protected — no peeking
            </div>
            <div className="relative">
              <div className={`transition duration-150 ${obscured ? "pointer-events-none blur-lg" : ""}`}>
                <p className="whitespace-pre-wrap text-[15px] font-medium leading-relaxed text-white">{q.question}</p>
                <div className="mt-4 grid gap-2">
                  {q.options.map((o, i) => {
                    const active = chosen[idx] === i;
                    return (
                      <button
                        key={i}
                        onClick={() => pick(i)}
                        disabled={locked}
                        className={`flex items-start gap-2.5 rounded-xl border p-3 text-left text-sm transition disabled:cursor-not-allowed ${
                          active
                            ? "border-ember-500/60 bg-ember-500/10 text-white shadow-glow-ember"
                            : "border-edge bg-ink-800/50 text-white/90 hover:border-ember-500/30 disabled:opacity-60"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                            active ? "bg-ember-500 text-white" : "bg-ink-700 text-mute"
                          }`}
                        >
                          {LETTER(i)}
                        </span>
                        <span>{o}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {obscured && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-ink-900/60 text-center backdrop-blur-sm">
                  <span className="flex items-center gap-2 text-sm text-mute">
                    <EyeOff size={15} className="text-ember-400" /> Hidden while the window is inactive
                  </span>
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-xs text-mute">Tap an answer to lock it in and move on.</p>
        </>
      )}

      {submitting && !result && !submitErr && (
        <Portal>
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm">
            <div className="dc-card w-full max-w-sm p-7 text-center">
              <Loader2 size={30} className="mx-auto animate-spin text-ember-400" />
              <h2 className="mt-4 font-display text-xl font-semibold text-white">Scoring your answers…</h2>
            </div>
          </div>
        </Portal>
      )}

      {submitErr && !result && (
        <Portal>
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm">
            <div className="dc-card animate-cap-slam w-full max-w-sm p-7 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/15 text-red-300">
                <X size={28} />
              </div>
              <h2 className="mt-4 font-display text-xl font-semibold text-white">Round ended</h2>
              <p className="mt-2 text-sm text-mute">{submitErr}</p>
              <div className="mt-6 flex gap-2">
                <button className="btn-ghost flex-1" onClick={() => router.push("/arcade")}>
                  Arcade
                </button>
                <button className="btn-ember flex-1" onClick={playAgain}>
                  Play again <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {result && (
        <Portal>
          <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-ink-900/80 p-4 backdrop-blur-sm">
            <div className="dc-card animate-cap-slam my-auto w-full max-w-md p-7 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-300">
                <Trophy size={28} />
              </div>
              <h2 className="mt-4 font-display text-3xl font-bold text-white">
                {result.correct}/{result.total}
              </h2>
              <p className="mt-1 text-sm text-mute">correct answers</p>
              <div className="mt-4 flex items-center justify-center gap-2 font-display text-3xl font-bold text-gradient-flame">
                <DarkCoinLogo size={26} /> +{formatDC(result.minted)} DC
              </div>
              {result.tooFast && (
                <p className="mt-2 text-xs text-ember-300">
                  Answered too fast — no DC awarded this round.
                </p>
              )}

              {/* per-question review with explanations */}
              <div className="mt-5 max-h-[42vh] space-y-1.5 overflow-y-auto pr-1 text-left">
                {quiz?.questions.map((qq, i) => {
                  const right = result.correctAnswers[i];
                  const mine = result.chosen[i];
                  const ok = mine === right;
                  const why = result.explanations[i];
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-lg border border-edge bg-ink-800/40 p-2.5 text-xs"
                    >
                      <span className={`mt-0.5 shrink-0 ${ok ? "text-grass-500" : "text-red-400"}`}>
                        {ok ? <Check size={14} /> : <X size={14} />}
                      </span>
                      <div className="min-w-0">
                        <div className="whitespace-pre-wrap text-white/90">{qq.question}</div>
                        <div className="mt-0.5 text-mute">
                          {!ok &&
                            (mine >= 0 ? (
                              <>
                                You: <span className="text-red-300">{LETTER(mine)}</span> ·{" "}
                              </>
                            ) : (
                              <>Skipped · </>
                            ))}
                          Answer: <span className="text-grass-500">{LETTER(right)}</span>
                        </div>
                        {why && <div className="mt-1 leading-relaxed text-mute/80">{why}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex gap-2">
                <button className="btn-ghost flex-1" onClick={() => router.push("/arcade")}>
                  Arcade
                </button>
                <button className="btn-ember flex-1" onClick={playAgain}>
                  Play again <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
