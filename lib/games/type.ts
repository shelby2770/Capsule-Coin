import "server-only";

import { config } from "@/lib/config";
import { round2 } from "@/lib/format";
import { LedgerError, arcadeGate, spendGamePlay, awardGameDc } from "@/lib/excel/store";
import { assertValidTier } from "@/lib/games/common";
import { assertCanStart } from "@/lib/games/word";
import { pickParagraph } from "@/lib/games/pools";
import {
  createSession,
  getSession,
  saveSession,
  deleteSession,
} from "@/lib/games/sessions";
import type { TypeStart, TypeSubmitResult } from "@/lib/types";

/** reward = baseReward at baseWpm, halving each stepWpm below it, 0 under minWpm. */
function typeReward(wpm: number): number {
  const { baseReward, baseWpm, stepWpm, minWpm } = config.games.type;
  if (wpm < minWpm) return 0;
  const bucket = Math.floor(wpm / stepWpm) * stepWpm; // round down to a 10-WPM band
  const steps = Math.max(0, (baseWpm - bucket) / stepWpm);
  return round2(baseReward / Math.pow(2, steps));
}

export async function startType(
  actor: { email: string; name: string },
  tier: number,
): Promise<TypeStart> {
  assertValidTier(tier);
  const gate = await arcadeGate(actor.email);
  assertCanStart(gate, tier);

  const difficulty = config.games.type.tierDifficulty[tier] ?? 5;
  const para = await pickParagraph(difficulty);

  // Create with the clock stopped; charge; THEN start the clock, so the CC-burn
  // round-trip isn't counted against the racer's time.
  const session = await createSession({
    email: actor.email.trim().toLowerCase(),
    kind: "type",
    tier,
    para: { id: para.id, text: para.text, difficulty: para.difficulty, startedAt: 0 },
  });
  try {
    await spendGamePlay(actor, tier, "type racing");
  } catch (e) {
    await deleteSession(session.id);
    throw e;
  }
  const startedAt = Date.now();
  session.para!.startedAt = startedAt;
  await saveSession(session);

  return {
    sessionId: session.id,
    tier,
    text: para.text,
    difficulty: para.difficulty,
    startedAtMs: startedAt,
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
  const reward = typeReward(wpm);

  let minted = 0;
  if (reward > 0) {
    const award = await awardGameDc(
      actor,
      reward,
      `Won ${reward} DC — type race ${Math.round(wpm)} WPM`,
    );
    minted = award.minted;
  }
  session.status = "done";
  session.totalReward = minted;
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
    totalReward: minted,
  };
}
