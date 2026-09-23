import "server-only";

import { config } from "@/lib/config";
import { round2 } from "@/lib/format";
import {
  LedgerError,
  arcadeGate,
  spendGamePlay,
  awardGameDc,
} from "@/lib/excel/store";
import { assertValidTier, type GameKind } from "@/lib/games/common";
import { consumeWords } from "@/lib/games/pools";
import { assertNotGameBanned, reportGameGuard } from "@/lib/games/bans";
import {
  createSession,
  getSession,
  saveSession,
  deleteSession,
  playedTierToday,
  type GameSession,
  type WordItem,
} from "@/lib/games/sessions";
import type { WordBoard, WordGuessResult, GameGuardResult } from "@/lib/types";

export type LetterState = "correct" | "present" | "absent";

/** Wordle-style scoring with correct duplicate-letter handling. */
export function scoreGuess(guess: string, answer: string): LetterState[] {
  const n = answer.length;
  const res: LetterState[] = new Array(n).fill("absent");
  const counts: Record<string, number> = {};
  for (const ch of answer) counts[ch] = (counts[ch] ?? 0) + 1;
  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) {
      res[i] = "correct";
      counts[guess[i]] -= 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (res[i] === "correct") continue;
    const ch = guess[i];
    if ((counts[ch] ?? 0) > 0) {
      res[i] = "present";
      counts[ch] -= 1;
    }
  }
  return res;
}

/**
 * Reward for a solved word. Guess-count sets the base — a FIRST-guess solve pays
 * baseReward (100); from the 2nd guess it drops to secondChanceReward (10) and
 * halves each extra guess (3rd = 5, 4th = 2.5, …). That base is then cut for
 * unusually slow play (time factor) and scaled by the tier's reward multiplier
 * (free ×1, paid tiers pay proportionally more).
 */
function wordReward(attempts: number, elapsedSec: number, tier: number): number {
  const { baseReward, secondChanceReward, secPerAttempt, timeFloor, tierRewardMult } =
    config.games.word;
  const a = Math.max(1, attempts);
  const base = a <= 1 ? baseReward : secondChanceReward / Math.pow(2, a - 2);
  const expected = secPerAttempt * a;
  const timeFactor =
    elapsedSec <= expected ? 1 : Math.max(timeFloor, expected / Math.max(1, elapsedSec));
  const mult = tierRewardMult[tier] ?? 1;
  return round2(base * timeFactor * mult);
}

/** Session lifespan in ms for a tier (the on-screen clock counts toward this). */
function sessionTtlMs(tier: number): number {
  const ttls = config.games.word.sessionTtlSec;
  return (ttls[tier] ?? ttls[0]) * 1000;
}

/**
 * Close a session that has outlived its TTL: the current (unfinished) word is
 * marked failed and the session is finalized. DC already minted per solved word
 * stays. Returns true if this call closed it. No-op on already-closed sessions.
 */
async function closeIfExpired(session: GameSession): Promise<boolean> {
  if (session.status !== "active") return false;
  if (Date.now() <= session.createdAt + sessionTtlMs(session.tier)) return false;
  const words = session.words ?? [];
  const cur = words[session.currentIndex ?? 0];
  if (cur && !cur.solved && !cur.failed) cur.failed = true;
  session.status = "done";
  await saveSession(session);
  return true;
}

/** Pre-flight checks shared by the word + type games (before anything is spent). */
export function assertCanStart(
  gate: Awaited<ReturnType<typeof arcadeGate>>,
  tier: number,
): void {
  if (gate.standing === "BANNED") {
    throw new LedgerError("BANNED", "Your account is frozen — you can't play right now.");
  }
  if (gate.standing === "GRACE") {
    throw new LedgerError(
      "GRACE_LOCKED",
      `You're below the ${config.balanceFloor} CC floor — recover before playing.`,
    );
  }
  if (gate.reserveRemaining <= 0) {
    throw new LedgerError(
      "RESERVE_EMPTY",
      "The DC reserve is tapped out — wins pay nothing until DC is spent back into the pool.",
    );
  }
  if (tier <= 0) {
    if (gate.freeRemaining <= 0) {
      throw new LedgerError(
        "NO_FREE_PLAY",
        "You've used your free game play today. Pay a DC tier to play more, or come back tomorrow.",
      );
    }
  } else {
    const fee = gate.tierFees[tier - 1];
    if (round2(gate.dcBalance) < fee) {
      throw new LedgerError(
        "INSUFFICIENT_DC",
        `Not enough DC — tier ${tier} costs ${fee} DC and you have ${round2(gate.dcBalance)}.`,
      );
    }
  }
}

/**
 * Each paid tier of a game is playable ONCE per UTC day (per game), resetting
 * daily like the free play. The free tier (0) is already limited by the games'
 * shared daily budget, so this only guards paid tiers. Throws if already used today.
 */
export async function assertTierNotUsedToday(
  email: string,
  kind: GameKind,
  tier: number,
): Promise<void> {
  if (tier <= 0) return;
  if (await playedTierToday(email, kind, tier)) {
    throw new LedgerError(
      "TIER_USED_TODAY",
      `You've already played Tier ${tier} of this game today — each paid tier is once a day, and resets tomorrow.`,
    );
  }
}

/** Public board view of a word session (never leaks the answer). */
export function wordBoard(session: GameSession): WordBoard {
  const words = session.words ?? [];
  const idx = session.currentIndex ?? 0;
  const cur = words[idx];
  const maxAttempts = session.maxAttempts ?? config.games.word.maxAttempts;
  const attempts = (cur?.attempts ?? []).map((g) => ({
    guess: g.toUpperCase(),
    feedback: scoreGuess(g, cur.answer),
  }));
  return {
    sessionId: session.id,
    tier: session.tier,
    wordsTotal: words.length,
    wordIndex: idx,
    wordsSolved: words.filter((w) => w.solved).length,
    wordLength: cur?.length ?? config.games.word.lengths[0],
    maxAttempts,
    attemptsUsed: cur?.attempts.length ?? 0,
    attempts,
    done: session.status !== "active",
    // Once the session is over (solved-out or timed out), reveal the current
    // word's answer if it wasn't solved — so a timeout shows the word, mirroring
    // the out-of-attempts path. Never populated while the game is active.
    revealed:
      session.status !== "active" && cur && !cur.solved ? cur.answer.toUpperCase() : null,
    totalReward: round2(session.totalReward),
    wordElapsedMs: cur && cur.servedAt ? Math.max(0, Date.now() - cur.servedAt) : 0,
    elapsedMs: Math.max(0, Date.now() - session.createdAt),
    ttlMs: sessionTtlMs(session.tier),
  };
}

export async function startWord(
  actor: { email: string; name: string },
  tier: number,
): Promise<WordBoard> {
  assertValidTier(tier);
  await assertNotGameBanned(actor.email, "word");
  const gate = await arcadeGate(actor.email);
  assertCanStart(gate, tier);
  await assertTierNotUsedToday(actor.email, "word", tier);

  const count = config.games.word.counts[tier] ?? 1;
  const raw = await consumeWords(count, config.games.word.lengths);
  const now = Date.now();
  const words: WordItem[] = raw.map((answer, i) => ({
    answer,
    length: answer.length,
    servedAt: i === 0 ? now : 0, // only the first word is "served" immediately
    attempts: [],
    solved: false,
    failed: false,
    reward: 0,
  }));

  const session = await createSession({
    email: actor.email.trim().toLowerCase(),
    kind: "word",
    tier,
    words,
    currentIndex: 0,
    maxAttempts: config.games.word.maxAttempts,
  });

  // Charge LAST — so the member is never charged without a playable session.
  try {
    await spendGamePlay(actor, tier, "the word game");
  } catch (e) {
    await deleteSession(session.id);
    throw e;
  }
  return wordBoard(session);
}

/**
 * Copy/screenshot guard. There's nothing legitimate to copy on the board, so ANY
 * reported copy attempt or detected PrtScn bans the member from Guess the Word
 * (this game only) for banDays and abandons the session. Best-effort + client-
 * driven; the ban decision is authoritative server-side (see reportGameGuard).
 */
export function reportWordGuard(
  actor: { email: string },
  sessionId: string,
): Promise<GameGuardResult> {
  return reportGameGuard(actor, sessionId, "word");
}

/** Reload a word session's board (for resume/refresh) with an ownership check. */
export async function wordState(
  actor: { email: string },
  sessionId: string,
): Promise<WordBoard> {
  const session = await getSession(sessionId);
  if (!session || session.kind !== "word") {
    throw new LedgerError("SESSION_NOT_FOUND", "That game session doesn't exist.");
  }
  if (session.email !== actor.email.trim().toLowerCase()) {
    throw new LedgerError("NOT_YOUR_SESSION", "That isn't your game.");
  }
  // Resuming: if the clock ran past the cap while away, finalize it now so the
  // returned board reflects the closed session.
  await closeIfExpired(session);
  return wordBoard(session);
}

export async function guessWord(
  actor: { email: string; name: string },
  sessionId: string,
  rawGuess: string,
): Promise<WordGuessResult> {
  const guess = String(rawGuess ?? "").trim().toLowerCase();
  const session = await getSession(sessionId);
  if (!session) throw new LedgerError("SESSION_NOT_FOUND", "That game session doesn't exist.");
  if (session.email !== actor.email.trim().toLowerCase()) {
    throw new LedgerError("NOT_YOUR_SESSION", "That isn't your game.");
  }
  if (session.kind !== "word") throw new LedgerError("BAD_GUESS", "Wrong game type.");
  // Time's up? Close + finalize, then reject this late guess.
  if (await closeIfExpired(session)) {
    throw new LedgerError("SESSION_CLOSED", "Time's up — this session has ended.");
  }
  if (session.status !== "active") throw new LedgerError("SESSION_CLOSED", "This game is already over.");

  const words = session.words ?? [];
  const cur = words[session.currentIndex ?? 0];
  const maxAttempts = session.maxAttempts ?? config.games.word.maxAttempts;
  if (!cur) throw new LedgerError("SESSION_CLOSED", "This game is already over.");
  if (!/^[a-z]+$/.test(guess) || guess.length !== cur.length) {
    throw new LedgerError("BAD_GUESS", `Enter a ${cur.length}-letter word.`);
  }
  if (cur.attempts.length >= maxAttempts) {
    throw new LedgerError("ATTEMPTS_DONE", "No attempts left on this word.");
  }

  cur.attempts.push(guess);
  const feedback = scoreGuess(guess, cur.answer);
  const solved = guess === cur.answer;
  let minted = 0;
  let revealed: string | null = null;

  if (solved) {
    const elapsedSec = (Date.now() - (cur.servedAt || Date.now())) / 1000;
    const reward = wordReward(cur.attempts.length, elapsedSec, session.tier);
    const award = await awardGameDc(
      actor,
      reward,
      `Won ${reward} DC — word game (solved in ${cur.attempts.length}/${maxAttempts})`,
    );
    minted = award.minted;
    cur.solved = true;
    cur.reward = minted;
    session.totalReward = round2(session.totalReward + minted);
  } else if (cur.attempts.length >= maxAttempts) {
    cur.failed = true;
    revealed = cur.answer.toUpperCase();
  }

  // Advance to the next word (or finish) once this one is resolved.
  const resolved = cur.solved || cur.failed;
  let done = false;
  if (resolved) {
    if ((session.currentIndex ?? 0) + 1 < words.length) {
      session.currentIndex = (session.currentIndex ?? 0) + 1;
      words[session.currentIndex].servedAt = Date.now();
    } else {
      session.status = "done";
      done = true;
    }
  }
  await saveSession(session);

  const nextIdx = session.currentIndex ?? 0;
  const next =
    resolved && !done
      ? {
          wordIndex: nextIdx,
          wordLength: words[nextIdx].length,
          attemptsUsed: words[nextIdx].attempts.length,
        }
      : null;

  return {
    feedback,
    solved,
    minted,
    attemptsUsed: cur.attempts.length,
    attemptsLeft: maxAttempts - cur.attempts.length,
    wordComplete: resolved,
    revealed,
    done,
    wordsSolved: words.filter((w) => w.solved).length,
    wordsTotal: words.length,
    totalReward: round2(session.totalReward),
    next,
  };
}
