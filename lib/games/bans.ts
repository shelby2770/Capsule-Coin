import "server-only";

import { LedgerError } from "@/lib/excel/store";
import { config } from "@/lib/config";
import { gameCollection, GAME_BANS, type GameKind } from "@/lib/games/common";
import { getSession, saveSession } from "@/lib/games/sessions";
import type { GameGuardResult } from "@/lib/types";

/**
 * Game-scoped temporary bans, kept OUT of the ledger (the account-level `banned`
 * flag is a permanent credit-floor lockout — a different thing). A copy/screenshot
 * cheat is locked out of THAT ONE game for a few days without touching their
 * account or the other games. One doc per member in GAME_BANS, holding a
 * `<kind>BanUntil` ms-epoch field per game — so the pre-existing `problemBanUntil`
 * data keeps working unchanged, and word/blitz just add their own fields.
 */
type BanField = `${GameKind}BanUntil`;
type BanDoc = Partial<Record<BanField, number>> & { email: string };

const banRef = (email: string) => gameCollection(GAME_BANS).doc(email.trim().toLowerCase());
const banField = (kind: GameKind): BanField => `${kind}BanUntil`;

/** Display name per game (for the lockout message). */
const GAME_LABEL: Record<GameKind, string> = {
  word: "Guess the Word",
  type: "Type Racing",
  problem: "Problem Solving",
  blitz: "AI Blitz",
};

/** What got copied/screenshotted, per game (for the lockout message). */
const PROTECTED_NOUN: Record<GameKind, string> = {
  word: "the board",
  type: "the passage",
  problem: "the problem statement",
  blitz: "a question",
};

/** Ban duration (days) per game. Problem keeps its own env knob; word/blitz theirs. */
const BAN_DAYS: Record<GameKind, number> = {
  word: config.games.word.banDays,
  type: config.games.problem.banDays, // type has no copy/screenshot guard — harmless fallback
  problem: config.games.problem.banDays,
  blitz: config.games.blitz.banDays,
};

/** A stored ban time, but only if it's still in the future (else 0 = not banned). */
function liveUntil(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > Date.now() ? n : 0;
}

/** Ms epoch the member's ban on ONE game lifts, or 0 if not banned. */
export async function gameBanUntil(email: string, kind: GameKind): Promise<number> {
  const snap = await banRef(email).get();
  return snap.exists ? liveUntil((snap.data() as BanDoc)?.[banField(kind)]) : 0;
}

/** Every live game ban for a member in ONE read — {kind: msUntil} (0 = not banned). */
export async function allGameBans(email: string): Promise<Record<GameKind, number>> {
  const snap = await banRef(email).get();
  const d = (snap.exists ? snap.data() : {}) as BanDoc;
  return {
    word: liveUntil(d.wordBanUntil),
    type: liveUntil(d.typeBanUntil),
    problem: liveUntil(d.problemBanUntil),
    blitz: liveUntil(d.blitzBanUntil),
  };
}

/** Ban this member from ONE game for its banDays. Returns the lift time (ms epoch). */
export async function banFromGame(email: string, kind: GameKind): Promise<number> {
  const until = Date.now() + BAN_DAYS[kind] * 24 * 60 * 60 * 1000;
  await banRef(email).set(
    { email: email.trim().toLowerCase(), [banField(kind)]: until },
    { merge: true },
  );
  return until;
}

/** Throw a BANNED LedgerError if the member is currently locked out of this game. */
export async function assertNotGameBanned(email: string, kind: GameKind): Promise<void> {
  const until = await gameBanUntil(email, kind);
  if (until > 0) {
    throw new LedgerError(
      "GAME_BANNED",
      `You're locked out of ${GAME_LABEL[kind]} until ${new Date(until).toUTCString()} for copying or screenshotting ${PROTECTED_NOUN[kind]}.`,
    );
  }
}

/**
 * Copy/screenshot guard for the short-content games (Guess the Word, AI Blitz):
 * there's nothing legitimate to copy, so ANY reported copy attempt or detected
 * screenshot immediately bans the member from THAT game for banDays and abandons
 * the live session. Best-effort and client-driven (a screenshot has already
 * happened by the time we hear about it) — but the ban decision is authoritative
 * here. Longer-statement Problem Solving uses its own ratio-based guard instead.
 */
export async function reportGameGuard(
  actor: { email: string },
  sessionId: string,
  kind: GameKind,
): Promise<GameGuardResult> {
  const lower = actor.email.trim().toLowerCase();
  const session = await getSession(sessionId);
  // Missing / not theirs / already-closed session → just report current ban state
  // (a stale client after the ban still gets a coherent answer, and we never touch
  // someone else's session).
  if (!session || session.kind !== kind || session.email !== lower || session.status !== "active") {
    const until = await gameBanUntil(lower, kind);
    return { banned: until > 0, banUntilMs: until };
  }
  session.status = "abandoned";
  await saveSession(session);
  const banUntilMs = await banFromGame(lower, kind);
  return { banned: true, banUntilMs };
}
