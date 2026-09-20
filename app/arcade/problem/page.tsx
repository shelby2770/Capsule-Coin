"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { GameIntroModal, type TierOption } from "@/components/GameIntroModal";
import { Portal } from "@/components/Portal";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { emitLedgerChange } from "@/lib/ledgerEvents";
import { formatCC, formatDC } from "@/lib/format";
import type {
  ArcadeStatus,
  ProblemBoard,
  ProblemGate,
  ProblemSubmitResult,
  ProblemCopyResult,
} from "@/lib/types";
import { toast } from "sonner";
import { Code2, Loader2, Timer, Trophy, ArrowRight, Ban, ShieldAlert, Lightbulb, RotateCcw } from "lucide-react";

type Lang = "cpp" | "python";

const DIFF_LABEL: Record<number, string> = {
  1: "Easy",
  2: "Easy–Med",
  3: "Medium",
  4: "Hard",
  5: "Very Hard",
};

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function ArcadeProblemPage() {
  return (
    <AppShell>
      <ProblemGame />
    </AppShell>
  );
}

function ProblemGame() {
  const { authedFetch, refresh } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<ArcadeStatus | null>(null);
  const [gate, setGate] = useState<ProblemGate | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [board, setBoard] = useState<ProblemBoard | null>(null);
  const [lang, setLang] = useState<Lang>("cpp");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<ProblemSubmitResult | null>(null);
  const [banUntil, setBanUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const autoSubmittedRef = useRef(false);
  // The answer fields are UNCONTROLLED (refs, not React state) so each keeps its
  // own native, per-element undo history — Ctrl+Z in one never touches the other,
  // and Tab-insertion stays undoable. codeStash keeps each language's draft so the
  // C++/Python toggle can switch back and forth without losing work.
  const intuitionRef = useRef<HTMLTextAreaElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const codeStash = useRef<Record<Lang, string>>({ cpp: "", python: "" });

  // On mount: load the shared status + the problem gate (ban / availability).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [sr, gr] = await Promise.all([
          authedFetch("/api/arcade"),
          authedFetch("/api/arcade/problem", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "gate" }),
          }),
        ]);
        if (!alive) return;
        if (sr.ok) setStatus((await sr.json()) as ArcadeStatus);
        if (gr.ok) {
          const g = (await gr.json()) as ProblemGate;
          setGate(g);
          if (g.banned) setBanUntil(g.banUntilMs);
          else setShowIntro(true);
        } else {
          setShowIntro(true);
        }
      } catch {
        if (alive) setShowIntro(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authedFetch]);

  // Live countdown while solving.
  useEffect(() => {
    if (!board || result || grading) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [board, result, grading]);

  const msLeft = board ? Math.max(0, board.deadlineMs - now) : 0;

  const submit = useCallback(async () => {
    if (!board || grading) return;
    const intuition = intuitionRef.current?.value ?? "";
    const code = codeRef.current?.value ?? "";
    setGrading(true);
    try {
      const r = await authedFetch("/api/arcade/problem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          sessionId: board.sessionId,
          intuition,
          code,
          language: lang,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.message || "Submit failed — try again.");
        return;
      }
      setResult(d as ProblemSubmitResult);
      void refresh();
      emitLedgerChange();
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setGrading(false);
    }
  }, [authedFetch, board, grading, lang, refresh]);

  // Auto-submit once when the clock runs out.
  useEffect(() => {
    if (board && !result && !grading && !autoSubmittedRef.current && board.deadlineMs - now <= 0) {
      autoSubmittedRef.current = true;
      toast("Time's up — submitting for grading.");
      void submit();
    }
  }, [now, board, result, grading, submit]);

  // Warn before leaving an in-progress problem (it's a timed, one-shot entry).
  useEffect(() => {
    if (!board || result) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [board, result]);

  const tiers: TierOption[] = useMemo(() => {
    const fees = status?.tierFees ?? [20, 50, 100];
    const liveTiers = gate?.maxDc.length ?? 2; // how many tiers exist (free + paid)
    const topics = gate?.topics ?? [];
    const freeUsed = (status?.freeRemaining ?? 0) <= 0;
    const opts: TierOption[] = [
      {
        tier: 0,
        label: "Free",
        cost: 0,
        detail: "A random problem",
        disabled: freeUsed,
        note: freeUsed ? "Free play used today" : undefined,
      },
    ];
    if (liveTiers > 1) {
      opts.push({
        tier: 1,
        label: "Tier 1",
        cost: fees[0],
        detail: "Choose your topic",
        topics,
        disabled: topics.length === 0,
        note: topics.length === 0 ? "No topics yet" : undefined,
      });
    }
    for (let t = liveTiers; t <= fees.length; t++) {
      opts.push({
        tier: t,
        label: `Tier ${t}`,
        cost: fees[t - 1],
        detail: "Coming soon",
        disabled: true,
      });
    }
    return opts;
  }, [status, gate]);

  async function start(tier: number, topic?: string) {
    setStarting(true);
    setStartErr(null);
    try {
      const r = await authedFetch("/api/arcade/problem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", tier, topic }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.error === "PROBLEM_BANNED") setBanUntil(Date.now() + 1); // trigger the banned screen
        setStartErr(d.message || "Couldn't start the game.");
        return;
      }
      const b = d as ProblemBoard;
      autoSubmittedRef.current = false;
      // Seed each language's draft with its boilerplate; the fields mount fresh
      // (keyed on sessionId) with these as defaultValue.
      codeStash.current = { cpp: b.boilerplate.cpp, python: b.boilerplate.python };
      setLang("cpp");
      setBoard(b);
      setNow(Date.now());
      setShowIntro(false);
      void refresh();
    } catch {
      setStartErr("Network error — try again.");
    } finally {
      setStarting(false);
    }
  }

  // Copy-guard: block the clipboard write and report the attempted length; the
  // server bans (this game only) once cumulative copying crosses the threshold.
  const reportCopy = useCallback(
    async (chars: number) => {
      if (!board) return;
      try {
        const r = await authedFetch("/api/arcade/problem", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "copy", sessionId: board.sessionId, chars }),
        });
        if (!r.ok) return;
        const d = (await r.json()) as ProblemCopyResult;
        if (d.banned) {
          setBanUntil(d.banUntilMs);
          setBoard(null);
        }
      } catch {
        /* best-effort */
      }
    },
    [authedFetch, board],
  );

  const onCopyAttempt = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const len = (window.getSelection()?.toString() ?? "").length;
      if (len > 0) {
        toast.error("Copying the problem is disabled — and monitored.");
        void reportCopy(len);
      }
    },
    [reportCopy],
  );

  function switchLang(next: Lang) {
    if (next === lang) return;
    // Keep each language's draft: stash the current editor, restore the other one.
    // Every switch works (no "untouched" guard) and neither side's work is lost.
    if (codeRef.current) {
      codeStash.current[lang] = codeRef.current.value;
      codeRef.current.value = codeStash.current[next];
    }
    setLang(next);
  }

  function onCodeKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    // execCommand inserts at the caret AND records an undo step, so Tab stays
    // undoable (a manual value splice would wipe the field's native undo history).
    document.execCommand("insertText", false, "    ");
  }

  // Anti-cheat: the answer must be typed within the clock — block paste and
  // drag-drop into both the notepad and the code editor.
  function blockPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    toast.error("Pasting into your answer is disabled — type it out.");
  }
  function blockDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
  }

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
            You&apos;re banned from Problem Solving for copying the problem statement. Access returns on
          </p>
          <p className="mt-1 font-semibold text-white">{new Date(banUntil).toUTCString()}</p>
          <p className="mt-2 text-xs text-mute">
            This affects Problem Solving only — your account and the other games are unaffected.
          </p>
          <button className="btn-ember mt-6 w-full" onClick={() => router.push("/arcade")}>
            Back to Arcade
          </button>
        </div>
      </div>
    );
  }

  if (!board && !showIntro) {
    return (
      <div className="flex h-72 items-center justify-center text-mute">
        <Loader2 className="animate-spin text-ember-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="text-center">
        <h1 className="flex items-center justify-center gap-2 font-display text-2xl font-bold text-white">
          <Code2 size={22} className="text-ember-400" /> Problem Solving
        </h1>
        <p className="mt-1 text-sm text-mute">
          Read the problem, write your approach and code, and let the AI judge score it for DC.
        </p>
      </div>

      {showIntro && (
        <GameIntroModal
          title="Problem Solving"
          icon={<Code2 size={22} />}
          intro="A LeetCode-style problem lands on the clock. Jot down your intuition — and code, if you can — before time runs out, then an AI judge reviews your work and forges DC based on how well you solved it."
          rules={[
            "You get 5 minutes on a server-side clock — it keeps ticking even if you step away, and auto-submits your work when it hits zero.",
            "Sketch your approach in the notepad, and add C++ or Python code if time allows — Tab indents, and starter boilerplate is ready for you.",
            "The statement is copy-protected — you're free to read it, but copying large parts of it locks you out of this game for 3 days.",
          ]}
          tiers={tiers}
          busy={starting}
          error={startErr}
          onContinue={start}
          onBack={() => router.push("/arcade")}
        />
      )}

      {board && !result && (
        <>
          {/* status bar */}
          <div className="dc-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div className="min-w-0">
              <div className="truncate font-semibold text-white">{board.title}</div>
              <div className="text-xs text-mute">
                {DIFF_LABEL[board.difficulty] ?? `Difficulty ${board.difficulty}`}
                <span className="mx-1.5 text-mute/40">·</span>
                <span className="capitalize">{board.topic.replace(/-/g, " ")}</span>
                {board.tier > 0 && <span className="ml-1.5 text-ember-300">Tier {board.tier}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-1 tabular-nums ${
                  msLeft <= 60_000 ? "text-ember-300" : "text-mute"
                }`}
              >
                <Timer size={14} /> {fmtClock(msLeft)}
              </span>
            </div>
          </div>

          {/* problem statement (copy-guarded) */}
          <div className="dc-card p-5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-mute">
              <ShieldAlert size={13} className="text-ember-400" /> Copy-protected — reading only
            </div>
            <div
              onCopy={onCopyAttempt}
              onCut={onCopyAttempt}
              onContextMenu={(e) => e.preventDefault()}
              className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-white/90"
            >
              {board.statement}
            </div>
          </div>

          {/* notepad — intuition */}
          <div className="dc-card p-4">
            <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-mute">
              <Lightbulb size={14} className="text-gold-500" /> Your intuition / approach
            </label>
            <textarea
              key={`int-${board.sessionId}`}
              ref={intuitionRef}
              defaultValue=""
              onPaste={blockPaste}
              onDrop={blockDrop}
              placeholder="Explain how you'd solve it — the key idea, data structures, complexity…"
              spellCheck={false}
              className="h-28 w-full resize-y rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-mute/50 focus:border-ember-500/60"
            />
          </div>

          {/* code editor */}
          <div className="dc-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-mute">Code (optional)</span>
              <div className="flex gap-1">
                {(["cpp", "python"] as Lang[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => switchLang(l)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      lang === l
                        ? "bg-ember-500/20 text-ember-200"
                        : "bg-ink-700/70 text-mute hover:text-white"
                    }`}
                  >
                    {l === "cpp" ? "C++" : "Python"}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              key={`code-${board.sessionId}`}
              ref={codeRef}
              defaultValue={board.boilerplate.cpp}
              onKeyDown={onCodeKeyDown}
              onPaste={blockPaste}
              onDrop={blockDrop}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="h-64 w-full resize-y rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 font-mono text-[13px] leading-relaxed text-white outline-none placeholder:text-mute/50 focus:border-ember-500/60"
            />
            <p className="mt-1.5 text-[11px] text-mute">Tab inserts 4 spaces · pasting is disabled. The judge reads both your intuition and code.</p>
          </div>

          <div className="flex items-center justify-between">
            <button className="btn-ghost" onClick={() => router.push("/arcade")} disabled={grading}>
              Give up
            </button>
            <button className="btn-ember" onClick={() => void submit()} disabled={grading}>
              {grading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {grading ? "Grading…" : "Submit for grading"}
            </button>
          </div>
        </>
      )}

      {/* grading overlay */}
      {grading && !result && (
        <Portal>
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm">
            <div className="dc-card w-full max-w-sm p-7 text-center">
              <Loader2 size={30} className="mx-auto animate-spin text-ember-400" />
              <h2 className="mt-4 font-display text-xl font-semibold text-white">The AI judge is grading…</h2>
              <p className="mt-1 text-sm text-mute">Scoring your approach and code out of 10.</p>
            </div>
          </div>
        </Portal>
      )}

      {result && (
        <Portal>
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm">
            <div className="dc-card animate-cap-slam w-full max-w-sm p-7 text-center">
              {result.refunded ? (
                <>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-mute">
                    <RotateCcw size={28} />
                  </div>
                  <h2 className="mt-4 font-display text-xl font-semibold text-white">
                    Couldn&apos;t grade in time
                  </h2>
                  <p className="mt-2 text-sm text-mute">{result.feedback}</p>
                  <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm font-semibold text-white">
                    {result.refunded.mode === "free"
                      ? "Free play returned"
                      : `+${formatCC(result.refunded.fee)} CC refunded`}
                  </div>
                </>
              ) : (
                <>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-300">
                    <Trophy size={28} />
                  </div>
                  <h2 className="mt-4 font-display text-3xl font-bold text-white">{result.mark}/10</h2>
                  <p className="mt-2 text-sm text-mute">{result.feedback}</p>
                  {result.breakdown && result.breakdown.length > 0 && (
                    <div className="mt-4 space-y-2 text-left">
                      {result.breakdown.map((b) => (
                        <div key={b.label} className="flex items-center gap-2.5">
                          <span className="w-36 shrink-0 text-[11px] text-mute">{b.label}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-ember-500"
                              style={{ width: `${Math.round((b.score / b.max) * 100)}%` }}
                            />
                          </div>
                          <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-white/80">
                            {b.score}/{b.max}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 flex items-center justify-center gap-2 font-display text-3xl font-bold text-gradient-flame">
                    <DarkCoinLogo size={26} /> +{formatDC(result.minted)} DC
                  </div>
                </>
              )}
              <div className="mt-6 flex gap-2">
                <button className="btn-ghost flex-1" onClick={() => router.push("/arcade")}>
                  Arcade
                </button>
                <button
                  className="btn-ember flex-1"
                  onClick={() => {
                    setResult(null);
                    setBoard(null);
                    void (async () => {
                      const [sr, gr] = await Promise.all([
                        authedFetch("/api/arcade"),
                        authedFetch("/api/arcade/problem", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ action: "gate" }),
                        }),
                      ]);
                      if (sr.ok) setStatus((await sr.json()) as ArcadeStatus);
                      if (gr.ok) {
                        const g = (await gr.json()) as ProblemGate;
                        setGate(g);
                        if (g.banned) setBanUntil(g.banUntilMs);
                        else setShowIntro(true);
                      } else {
                        setShowIntro(true);
                      }
                    })();
                  }}
                >
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
