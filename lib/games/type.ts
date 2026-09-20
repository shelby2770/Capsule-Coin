import "server-only";

import { config } from "@/lib/config";
import { round2 } from "@/lib/format";
import { LedgerError, arcadeGate, spendGamePlay, awardGameDc } from "@/lib/excel/store";
import { assertValidTier } from "@/lib/games/common";
import { assertCanStart, assertTierNotUsedToday } from "@/lib/games/word";
import { pickParagraph } from "@/lib/games/pools";
import {
  createSession,
  getSession,
  saveSession,
  deleteSession,
} from "@/lib/games/sessions";
import type { TypeStart, TypeSubmitResult } from "@/lib/types";

/**
 * Base DC contribution follows a CONTINUOUS curve of net WPM (no 10-WPM bucketing):
 *   calc_DC(x) = baseReward                             for x >= baseWpm
 *              = baseReward * 2^((x - baseWpm)/stepWpm)  for x <  baseWpm
 * i.e. the full baseReward at/above baseWpm, halving smoothly every stepWpm below it,
 * all the way toward 0 WPM (no hard floor; e.g. 20 WPM → 0.39 base). The result is
 * then × the tier's paid multiplier (free=1, paid tiers pay proportionally more).
 */
function typeReward(wpm: number, tier: number): number {
  const { baseReward, baseWpm, stepWpm, tierRewardMult } = config.games.type;
  const x = Math.min(Math.max(0, wpm), baseWpm); // clamp: x >= baseWpm earns the full base
  const base = baseReward * Math.pow(2, (x - baseWpm) / stepWpm);
  const mult = tierRewardMult[tier] ?? 1;
  return round2(base * mult);
}

export async function startType(
  actor: { email: string; name: string },
  tier: number,
): Promise<TypeStart> {
  assertValidTier(tier);
  const gate = await arcadeGate(actor.email);
  assertCanStart(gate, tier);
  await assertTierNotUsedToday(actor.email, "type", tier);

  const difficulty = config.games.type.tierDifficulty[tier] ?? 5;
  const para = await pickParagraph(difficulty);
  const reAttemptsLeft = config.games.type.reAttempts[tier] ?? 0;

  // Create with the clock stopped; charge; THEN start the clock, so the CC-burn
  // round-trip isn't counted against the racer's time.
  const session = await createSession({
    email: actor.email.trim().toLowerCase(),
    kind: "type",
    tier,
    para: { id: para.id, text: para.text, difficulty: para.difficulty, startedAt: 0 },
    bestWpm: 0,
    reAttemptsLeft,
  });
  try {
    await spendGamePlay(actor, tier, "type racing");
  } catch (e) {
    await deleteSession(session.id);
    throw e;
  }
  // Start the clock in the FUTURE: the client shows a get-ready countdown over the
  // (readable) passage, and the reward timer only begins once it hits zero — so the
  // breather + the CC-burn round-trip aren't counted against the racer's time.
  const countdownMs = Math.max(0, config.games.type.countdownSec * 1000);
  const startedAt = Date.now() + countdownMs;
  session.para!.startedAt = startedAt;
  await saveSession(session);

  return {
    sessionId: session.id,
    tier,
    text: para.text,
    difficulty: para.difficulty,
    startedAtMs: startedAt,
    countdownMs,
    reAttemptsLeft,
  };
}

/**
 * Spend one free re-attempt on a paid entry: serve a FRESH paragraph (same
 * difficulty), no CC charge, and restart the clock (with the same get-ready
 * countdown). Works both AFTER a finished race (chase a better score) and MID-race
 * (a "restart" if you fumble) — either way it costs one retry from the tier's
 * budget. The reward top-up (best run only) is settled on the next submit, so a
 * re-attempt can raise your DC but never farm it.
 */
export async function reAttemptType(
  actor: { email: string; name: string },
  sessionId: string,
): Promise<TypeStart> {
  const session = await getSession(sessionId);
  if (!session) throw new LedgerError("SESSION_NOT_FOUND", "That game session doesn't exist.");
  if (session.email !== actor.email.trim().toLowerCase()) {
    throw new LedgerError("NOT_YOUR_SESSION", "That isn't your game.");
  }
  if (session.kind !== "type" || !session.para) {
    throw new LedgerError("WRONG_TEXT", "Wrong game type.");
  }
  if ((session.reAttemptsLeft ?? 0) <= 0) {
    throw new LedgerError("NO_REATTEMPTS", "No re-attempts left on this entry.");
  }

  const difficulty = config.games.type.tierDifficulty[session.tier] ?? 5;
  const para = await pickParagraph(difficulty);
  const countdownMs = Math.max(0, config.games.type.countdownSec * 1000);
  const startedAt = Date.now() + countdownMs;
  session.reAttemptsLeft = (session.reAttemptsLeft ?? 0) - 1;
  session.status = "active";
  session.para = { id: para.id, text: para.text, difficulty: para.difficulty, startedAt };
  await saveSession(session);

  return {
    sessionId: session.id,
    tier: session.tier,
    text: para.text,
    difficulty: para.difficulty,
    startedAtMs: startedAt,
    countdownMs,
    reAttemptsLeft: session.reAttemptsLeft,
  };
}

export async function submitType(
  actor: { email: string; name: string },
  sessionId: string,
  typedText: string,
  keystrokes?: number,
): Promise<TypeSubmitResult> {
  const session = await getSession(sessionId);
  if (!session) throw new LedgerError("SESSION_NOT_FOUND", "That game session doesn't exist.");
  if (session.email !== actor.email.trim().toLowerCase()) {
    throw new LedgerError("NOT_YOUR_SESSION", "That isn't your game.");
  }
  if (session.kind !== "type" || !session.para) {
    throw new LedgerError("WRONG_TEXT", "Wrong game type.");
  }
  if (session.status !== "active") throw new LedgerError("SESSION_CLOSED", "This race is already over.");

  const target = session.para.text;
  if (typeof typedText !== "string" || typedText !== target) {
    throw new LedgerError("WRONG_TEXT", "Type the whole paragraph exactly (fix every red letter) to finish.");
  }

  const elapsedSec = (Date.now() - (session.para.startedAt || Date.now())) / 1000;
  // Anti-cheat: reject an impossibly fast submit (e.g. a paste). The fastest
  // allowed time is the length at maxWpm, with a small tolerance.
  const maxCharsPerSec = (config.games.type.maxWpm * 5) / 60;
  const minElapsed = target.length / maxCharsPerSec;
  if (elapsedSec < minElapsed * 0.9) {
    // Close the session so the entry (already paid) isn't reusable, then reject.
    session.status = "done";
    await saveSession(session);
    throw new LedgerError("TOO_FAST", "That was impossibly fast — no reward given.");
  }

  let wpm = target.length / 5 / (elapsedSec / 60);
  wpm = Math.min(wpm, config.games.type.maxWpm);

  // Reward tracks the BEST run on this entry. Re-attempts only ever mint the
  // improvement over what's already been paid (deserved − alreadyMinted), so a
  // retry can raise your DC toward your best but can never farm extra.
  const newBest = Math.max(session.bestWpm ?? 0, wpm);
  const alreadyMinted = round2(session.totalReward ?? 0);
  const deserved = typeReward(newBest, session.tier);
  const topUp = Math.max(0, round2(deserved - alreadyMinted));

  let minted = 0;
  if (topUp > 0) {
    const award = await awardGameDc(
      actor,
      topUp,
      `Won ${topUp} DC — type race ${Math.round(wpm)} WPM`,
    );
    minted = award.minted;
  }
  session.bestWpm = newBest;
  session.totalReward = round2(alreadyMinted + minted);
  session.status = "done";
  await saveSession(session);

  const accuracy =
    keystrokes && keystrokes >= target.length
      ? round2((target.length / keystrokes) * 100)
      : 100;

  return {
    wpm: round2(wpm),
    accuracy,
    elapsedSec: round2(elapsedSec),
    minted,
    totalReward: session.totalReward,
    bestWpm: round2(newBest),
    improved: minted > 0,
    reAttemptsLeft: session.reAttemptsLeft ?? 0,
  };
}
