"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { GameIntroModal, type TierOption } from "@/components/GameIntroModal";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { emitLedgerChange } from "@/lib/ledgerEvents";
import { formatDC } from "@/lib/format";
import type {
  ArcadeStatus,
  WordBoard,
  WordGuessResult,
  GameLetterState,
  GameGuardResult,
} from "@/lib/types";
import { toast } from "sonner";
import {
  Puzzle,
  Loader2,
  Delete,
  CornerDownLeft,
  Trophy,
  ArrowRight,
  Timer,
  Hash,
  Ban,
  ShieldAlert,
  EyeOff,
} from "lucide-react";
import { Portal } from "@/components/Portal";

type Attempt = { guess: string; feedback: GameLetterState[] };
type Cur = {
  sessionId: string;
  tier: number;
  wordsTotal: number;
  wordIndex: number;
  wordsSolved: number;
  wordLength: number;
  maxAttempts: number;
  attempts: Attempt[];
  totalReward: number;
  ttlMs: number; // session lifespan (the clock counts up to this, then ends)
};

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const RANK: Record<GameLetterState, number> = { absent: 0, present: 1, correct: 2 };

/** m:ss for the session clock. */
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function tileClass(s: GameLetterState | "empty" | "active"): string {
  switch (s) {
    case "correct":
      return "bg-grass-500 border-grass-500 text-white";
    case "present":
      return "bg-gold-500 border-gold-500 text-ink-900";
    case "absent":
      return "bg-ink-700 border-ink-700 text-mute";
    case "active":
      return "border-ember-500/60 bg-ink-800/60 text-white";
    default:
      return "border-edge bg-ink-800/40 text-white";
  }
}

export default function ArcadeWordPage() {
  return (
    <AppShell>
      <WordGame />
    </AppShell>
  );
}

function WordGame() {
  const { authedFetch, refresh } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<ArcadeStatus | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [cur, setCur] = useState<Cur | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [banUntil, setBanUntil] = useState(0);
  // Screenshot deterrent: true while the window is blurred / the tab is hidden — the
  // board is blurred out then, so a Snipping-Tool grab captures nothing useful.
  const [obscured, setObscured] = useState(false);
  const [finished, setFinished] = useState<{
    words: number;
    total: number;
    dc: number;
    revealed?: string | null; // the unsolved word to reveal (on timeout / out of attempts)
  } | null>(null);
  // One server-anchored stopwatch for the whole session (base = server-measured
  // elapsed at fetch; at = client clock then; live value = base + (now − at)). It
  // runs the entire game, survives leave/return, and closes the session at the cap.
  const [sessionMs, setSessionMs] = useState(0);
  const sessionAnchorRef = useRef<{ base: number; at: number }>({ base: 0, at: Date.now() });
  const finalizingRef = useRef(false);

  const fromBoard = useCallback((b: WordBoard): Cur => {
    const now = Date.now();
    sessionAnchorRef.current = { base: b.elapsedMs, at: now };
    finalizingRef.current = false;
    setSessionMs(b.elapsedMs);
    return {
      sessionId: b.sessionId,
      tier: b.tier,
      wordsTotal: b.wordsTotal,
      wordIndex: b.wordIndex,
      wordsSolved: b.wordsSolved,
      wordLength: b.wordLength,
      maxAttempts: b.maxAttempts,
      attempts: b.attempts,
      totalReward: b.totalReward,
      ttlMs: b.ttlMs,
    };
  }, []);

  // On mount: resume an in-progress word game, else show the intro.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await authedFetch("/api/arcade");
        if (!alive) return;
        const s = (await r.json()) as ArcadeStatus;
        setStatus(s);
        if (s.bans.word > 0) {
          setBanUntil(s.bans.word); // locked out — show the ban screen, skip resume/intro
          return;
        }
        if (s.resumable?.kind === "word") {
          const sr = await authedFetch("/api/arcade/word", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "state", sessionId: s.resumable.sessionId }),
          });
          if (sr.ok && alive) {
            const b = (await sr.json()) as WordBoard;
            if (!b.done) {
              setCur(fromBoard(b));
              return;
            }
          }
        }
        if (alive) setShowIntro(true);
      } catch {
        if (alive) setShowIntro(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authedFetch, fromBoard]);

  // The session clock hit its cap while playing — pull the finalized board and
  // show the results (DC earned so far is already banked per solved word).
  const finalizeTimeout = useCallback(async () => {
    if (!cur) return;
    try {
      const r = await authedFetch("/api/arcade/word", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "state", sessionId: cur.sessionId }),
      });
      if (!r.ok) return;
      const b = (await r.json()) as WordBoard;
      if (b.done) {
        void refresh();
        emitLedgerChange();
        setFinished({
          words: b.wordsSolved,
          total: b.wordsTotal,
          dc: b.totalReward,
          revealed: b.revealed ?? null,
        });
      }
    } catch {
      /* the ticker will retry on the next tick */
    }
  }, [authedFetch, cur, refresh]);

  // Session stopwatch — runs the whole game, survives leave/return, and closes
  // the session once it reaches the cap.
  useEffect(() => {
    if (!cur || finished) return;
    const tick = () => {
      const now = Date.now();
      const sMs = sessionAnchorRef.current.base + (now - sessionAnchorRef.current.at);
      setSessionMs(sMs);
      if (sMs >= cur.ttlMs && !finalizingRef.current) {
        finalizingRef.current = true;
        void finalizeTimeout();
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [cur, finished, finalizeTimeout]);

  const keyStates = useMemo(() => {
    const m: Record<string, GameLetterState> = {};
    for (const a of cur?.attempts ?? []) {
      a.guess.toLowerCase().split("").forEach((ch, i) => {
        const s = a.feedback[i];
        if (!(ch in m) || RANK[s] > RANK[m[ch]]) m[ch] = s;
      });
    }
    return m;
  }, [cur?.attempts]);

  const tiers: TierOption[] = useMemo(() => {
    const counts = status?.wordCounts ?? [1, 3, 5, 10];
    const fees = status?.tierFees ?? [20, 50, 100];
    const freeUsed = (status?.freeRemaining ?? 0) <= 0;
    const opts: TierOption[] = [
      {
        tier: 0,
        label: "Free",
        cost: 0,
        detail: `${counts[0]} word`,
        disabled: freeUsed,
        note: freeUsed ? "Free play used today" : undefined,
      },
    ];
    for (let t = 1; t <= fees.length; t++) {
      opts.push({
        tier: t,
        label: `Tier ${t}`,
        cost: fees[t - 1],
        detail: `${counts[t]} words`,
      });
    }
    return opts;
  }, [status]);

  async function start(tier: number) {
    setStarting(true);
    setStartErr(null);
    try {
      const r = await authedFetch("/api/arcade/word", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", tier }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.error === "GAME_BANNED") setBanUntil(Date.now() + 1); // trigger the banned screen
        setStartErr(d.message || "Couldn't start the game.");
        return;
      }
      setCur(fromBoard(d as WordBoard));
      setShowIntro(false);
      setTyped("");
      void refresh();
    } catch {
      setStartErr("Network error — try again.");
    } finally {
      setStarting(false);
    }
  }

  const submit = useCallback(async () => {
    if (!cur || busy || finished) return;
    const guess = typed.toLowerCase();
    if (guess.length !== cur.wordLength) return;
    setBusy(true);
    try {
      const r = await authedFetch("/api/arcade/word", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "guess", sessionId: cur.sessionId, guess }),
      });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.message || "Guess rejected.");
        return;
      }
      const res = d as WordGuessResult;
      setTyped("");
      // Append this attempt — a solve paints the whole row green right away.
      setCur((prev) =>
        prev ? { ...prev, attempts: [...prev.attempts, { guess: guess.toUpperCase(), feedback: res.feedback }], totalReward: res.totalReward } : prev,
      );

      // Let the all-green row land and celebrate before tallying DC / moving on.
      if (res.solved) await new Promise((r) => setTimeout(r, 1050));

      if (res.solved) toast.success(`Solved! +${formatDC(res.minted)} DC 🔥`);
      else if (res.revealed) toast(`Out of tries — the word was ${res.revealed}.`);

      if (res.wordComplete) {
        void refresh();
        emitLedgerChange();
        if (res.done) {
          setFinished({
            words: res.wordsSolved,
            total: res.wordsTotal,
            dc: res.totalReward,
            revealed: res.revealed ?? null,
          });
        } else if (res.next) {
          // Advance to the next word — the session clock keeps running.
          setBanner(
            res.solved
              ? `Solved! +${formatDC(res.minted)} DC — next word (${res.wordsSolved + 1}/${res.wordsTotal})`
              : `Next word (${res.next.wordIndex + 1}/${res.wordsTotal})`,
          );
          setTimeout(() => setBanner(null), 2600);
          // New word served — the single session stopwatch keeps running.
          setCur((prev) =>
            prev
              ? {
                  ...prev,
                  wordIndex: res.next!.wordIndex,
                  wordLength: res.next!.wordLength,
                  wordsSolved: res.wordsSolved,
                  attempts: [],
                }
              : prev,
          );
        }
      }
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }, [authedFetch, busy, cur, finished, refresh, typed]);

  const onKey = useCallback(
    (k: string) => {
      if (!cur || busy || finished) return;
      if (k === "Enter") {
        void submit();
      } else if (k === "Backspace") {
        setTyped((t) => t.slice(0, -1));
      } else if (/^[a-z]$/.test(k)) {
        setTyped((t) => (t.length < cur.wordLength ? t + k : t));
      }
    },
    [busy, cur, finished, submit],
  );

  // Physical keyboard.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "Enter" || k === "Backspace" || /^[a-zA-Z]$/.test(k)) {
        e.preventDefault();
        onKey(k === "Enter" || k === "Backspace" ? k : k.toLowerCase());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onKey]);

  // Copy/screenshot guard — there's nothing legitimate to copy on the board, so any
  // attempt bans the member from Guess the Word (this game only) for a few days and
  // abandons the session. Best-effort + client-driven; the ban decision is
  // authoritative server-side.
  const reportGuard = useCallback(async () => {
    if (!cur) return;
    try {
      const r = await authedFetch("/api/arcade/word", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "guard", sessionId: cur.sessionId }),
      });
      if (!r.ok) return;
      const d = (await r.json()) as GameGuardResult;
      if (d.banned) {
        setBanUntil(d.banUntilMs);
        setCur(null);
      }
    } catch {
      /* best-effort */
    }
  }, [authedFetch, cur]);

  const onCopyAttempt = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      toast.error("Copying is disabled here — and monitored.");
      void reportGuard();
    },
    [reportGuard],
  );

  // Screenshot deterrent (no ban): blur the board whenever the window loses focus or
  // the tab is hidden — the Snipping Tool's overlay steals focus, so a grab then
  // captures a blurred board. Losing focus isn't proof of anything, so it never bans.
  useEffect(() => {
    if (!cur || finished) return;
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
  }, [cur, finished]);

  // PrtScn ban. Windows browsers surface the PrtScn keyup (only the keyup, and only
  // the physical key — never Win+Shift+S, macOS, or a phone). The capture already
  // happened by keyup, so this is retaliation, not prevention: the instant we see
  // it, we lock the member out of Guess the Word for a few days.
  useEffect(() => {
    if (!cur || finished) return;
    let sent = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "PrintScreen" || sent) return;
      sent = true;
      toast.error("Screenshot detected — you're locked out of Guess the Word.");
      void reportGuard();
    };
    window.addEventListener("keyup", onKey);
    return () => window.removeEventListener("keyup", onKey);
  }, [cur, finished, reportGuard]);

  // Once the current word is solved (last row all-green), suppress the empty
  // "next attempt" row and freeze the attempt counter during the ~1s win
  // celebration — otherwise the board flashes a blank input row before the reward
  // is tallied / the next word (or results) lands.
  const lastRow = cur?.attempts[cur.attempts.length - 1];
  const wordSolved =
    !!lastRow && lastRow.feedback.length > 0 && lastRow.feedback.every((f) => f === "correct");

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
            You&apos;re banned from Guess the Word for copying or screenshotting the game. Access returns on
          </p>
          <p className="mt-1 font-semibold text-white">{new Date(banUntil).toUTCString()}</p>
          <p className="mt-2 text-xs text-mute">
            This affects Guess the Word only — your account and the other games are unaffected.
          </p>
          <button className="btn-ember mt-6 w-full" onClick={() => router.push("/arcade")}>
            Back to Arcade
          </button>
        </div>
      </div>
    );
  }

  if (!cur && !showIntro) {
    return (
      <div className="flex h-72 items-center justify-center text-mute">
        <Loader2 className="animate-spin text-ember-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="text-center">
        <h1 className="flex items-center justify-center gap-2 font-display text-2xl font-bold text-white">
          <Puzzle size={22} className="text-ember-400" /> Guess the Word
        </h1>
        <p className="mt-1 text-sm text-mute">Green = right spot · Yellow = wrong spot · Grey = not in the word.</p>
      </div>

      {showIntro && (
        <GameIntroModal
          title="Guess the Word"
          icon={<Puzzle size={22} />}
          intro="Guess the hidden word. After each guess, tiles turn green (right letter, right spot), yellow (right letter, wrong spot), or grey (not in the word)."
          rules={[
            "Solve it in as few guesses as you can, and quickly — sharper, faster solves are worth more.",
            "Up to 7 guesses per word. Paid tiers give more words, shown one at a time.",
            "One timed session per play (3–20 minutes by tier) — the clock keeps running if you step away.",
            "Copying the board or taking a screenshot locks you out of this game for 3 days — just play it straight.",
          ]}
          tiers={tiers}
          busy={starting}
          error={startErr}
          onContinue={start}
          onBack={() => router.push("/arcade")}
        />
      )}

      {cur && (
        <>
          {/* status bar */}
          <div className="dc-card flex items-center justify-between p-4 text-sm">
            <div className="text-mute">
              Word <span className="font-semibold text-white">{cur.wordIndex + 1}</span>
              <span className="text-mute">/{cur.wordsTotal}</span>
              {cur.tier > 0 && <span className="ml-2 text-ember-300">Tier {cur.tier}</span>}
            </div>
            <div className="flex items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1 tabular-nums ${
                  cur.ttlMs - sessionMs <= 60_000 ? "text-ember-300" : "text-mute"
                }`}
                title={`Session time — keeps running if you leave and return; this session ends at ${fmtClock(cur.ttlMs)}`}
              >
                <Timer size={14} /> {fmtClock(sessionMs)}
                <span className="text-mute/50">/ {fmtClock(cur.ttlMs)}</span>
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-ember-300">
                <DarkCoinLogo size={14} /> {formatDC(cur.totalReward)}
              </span>
            </div>
          </div>

          {banner && (
            <div className="rounded-2xl border border-teal-500/40 bg-teal-500/10 p-3 text-center text-sm text-teal-200">
              {banner}
            </div>
          )}

          {/* board (copy-guarded + screenshot-deterrent) */}
          <div
            className="dc-card select-none p-4"
            onCopy={onCopyAttempt}
            onCut={onCopyAttempt}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="mb-2 flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wider text-mute">
              <ShieldAlert size={13} className="text-ember-400" /> Copy- &amp; screenshot-protected
            </div>
            <div className="mb-3 flex items-center justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-ink-800/60 px-3 py-1 text-xs">
                <Hash size={12} className="text-ember-400" />
                <span className="text-mute">Attempt</span>
                <span className="font-semibold text-white tabular-nums">
                  {cur.attempts.length + (finished || wordSolved ? 0 : 1)}
                </span>
                <span className="text-mute">of {cur.maxAttempts}</span>
              </span>
            </div>
            <div className="relative">
              <div
                className={`flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto pr-1 transition duration-150 ${
                  obscured ? "pointer-events-none blur-lg" : ""
                }`}
              >
                {cur.attempts.map((a, ri) => (
                  <Row
                    key={ri}
                    letters={a.guess.split("")}
                    states={a.feedback}
                    len={cur.wordLength}
                    win={ri === cur.attempts.length - 1 && a.feedback.every((f) => f === "correct")}
                  />
                ))}
                {!finished && !wordSolved && (
                  <Row
                    letters={typed.toUpperCase().split("")}
                    states={null}
                    len={cur.wordLength}
                    active
                  />
                )}
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

          {/* keyboard */}
          {!finished && (
            <div className="space-y-1.5">
              {KEY_ROWS.map((row, i) => (
                <div key={i} className="flex justify-center gap-1.5">
                  {i === 2 && (
                    <KeyBtn wide onClick={() => onKey("Enter")} disabled={busy || typed.length !== cur.wordLength}>
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <CornerDownLeft size={16} />}
                    </KeyBtn>
                  )}
                  {row.split("").map((ch) => (
                    <KeyBtn key={ch} state={keyStates[ch]} onClick={() => onKey(ch)} disabled={busy}>
                      {ch.toUpperCase()}
                    </KeyBtn>
                  ))}
                  {i === 2 && (
                    <KeyBtn wide onClick={() => onKey("Backspace")} disabled={busy}>
                      <Delete size={16} />
                    </KeyBtn>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {finished && (
        <Portal>
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm">
          <div className="dc-card animate-cap-slam w-full max-w-sm p-7 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ember-500/15 text-ember-300">
              <Trophy size={28} />
            </div>
            <h2 className="mt-4 font-display text-2xl font-semibold text-white">Game over</h2>
            <p className="mt-1 text-sm text-mute">
              Solved {finished.words} of {finished.total} word{finished.total === 1 ? "" : "s"}.
            </p>
            {finished.revealed && (
              <p className="mt-1 text-sm text-mute">
                The word was{" "}
                <span className="font-semibold uppercase tracking-wide text-white">
                  {finished.revealed}
                </span>
                .
              </p>
            )}
            <div className="mt-4 flex items-center justify-center gap-2 font-display text-3xl font-bold text-gradient-flame">
              <DarkCoinLogo size={26} /> +{formatDC(finished.dc)} DC
            </div>
            <div className="mt-6 flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => router.push("/arcade")}>
                Arcade
              </button>
              <button
                className="btn-ember flex-1"
                onClick={() => {
                  setFinished(null);
                  setCur(null);
                  void (async () => {
                    const r = await authedFetch("/api/arcade");
                    setStatus((await r.json()) as ArcadeStatus);
                    setShowIntro(true);
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

function Row({
  letters,
  states,
  len,
  active,
  win,
}: {
  letters: string[];
  states: GameLetterState[] | null;
  len: number;
  active?: boolean;
  win?: boolean;
}) {
  const cells = Array.from({ length: len }, (_, i) => ({
    ch: letters[i] ?? "",
    state: states ? states[i] : letters[i] ? ("active" as const) : ("empty" as const),
  }));
  return (
    <div className="flex justify-center gap-1.5">
      {cells.map((c, i) => (
        <div
          key={i}
          style={win ? { animationDelay: `${i * 70}ms` } : undefined}
          className={`flex h-11 w-11 items-center justify-center rounded-lg border text-lg font-bold uppercase transition ${tileClass(
            active && !c.ch ? "empty" : c.state,
          )} ${win ? "animate-win-pop" : ""}`}
        >
          {c.ch}
        </div>
      ))}
    </div>
  );
}

function KeyBtn({
  children,
  onClick,
  disabled,
  state,
  wide,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  state?: GameLetterState;
  wide?: boolean;
}) {
  const tone = state
    ? state === "correct"
      ? "bg-grass-500 text-white"
      : state === "present"
        ? "bg-gold-500 text-ink-900"
        : "bg-ink-700 text-mute"
    : "bg-ink-700/70 text-white hover:bg-ink-600";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-12 items-center justify-center rounded-lg text-sm font-semibold transition disabled:opacity-50 ${
        wide ? "px-3" : "w-8 sm:w-9"
      } ${tone}`}
    >
      {children}
    </button>
  );
}
