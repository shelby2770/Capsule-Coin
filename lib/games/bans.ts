import "server-only";

import { LedgerError } from "@/lib/excel/store";
import { config } from "@/lib/config";
import { gameCollection, GAME_BANS } from "@/lib/games/common";

/**
 * Game-scoped temporary bans, kept OUT of the ledger (the account-level `banned`
 * flag is a permanent credit-floor lockout — a different thing). Problem Solving
 * uses this to lock a copy-cheat out of THAT game for a few days without touching
 * their account or any other game. One doc per member in GAME_BANS.
 */

type BanDoc = { email: string; problemBanUntil?: number };

const banRef = (email: string) => gameCollection(GAME_BANS).doc(email.trim().toLowerCase());

/** Ms epoch the member's Problem-Solving ban lifts, or 0 if not banned. */
export async function problemBanUntil(email: string): Promise<number> {
  const snap = await banRef(email).get();
  const until = snap.exists ? Number((snap.data() as BanDoc)?.problemBanUntil ?? 0) : 0;
  return Number.isFinite(until) && until > Date.now() ? until : 0;
}

/** Ban this member from Problem Solving for config.games.problem.banDays. Returns the lift time. */
export async function banFromProblem(email: string): Promise<number> {
  const until = Date.now() + config.games.problem.banDays * 24 * 60 * 60 * 1000;
  await banRef(email).set({ email: email.trim().toLowerCase(), problemBanUntil: until }, { merge: true });
  return until;
}

/** Throw a BANNED LedgerError if the member is currently locked out of Problem Solving. */
export async function assertNotProblemBanned(email: string): Promise<void> {
  const until = await problemBanUntil(email);
  if (until > 0) {
    throw new LedgerError(
      "PROBLEM_BANNED",
      `You're locked out of Problem Solving until ${new Date(until).toUTCString()} for copying the problem statement.`,
    );
  }
}
