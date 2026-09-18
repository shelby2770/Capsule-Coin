import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { LedgerError } from "@/lib/excel/store";
import { config } from "@/lib/config";

/**
 * Arcade games keep their own state in SEPARATE Firestore collections (word /
 * paragraph pools + live sessions) so the single-doc ledger never has to carry
 * thousands of pool items or churn on every guess. Only the DC prize + CC entry
 * fee go through the ledger (see awardGameDc / spendGamePlay in the store).
 *
 * Collections are namespaced by LEDGER_DOC_ID exactly like the ledger doc, so a
 * test/staging run (LEDGER_DOC_ID=capsule_test) gets its own isolated pools and
 * never touches the live ones.
 */
const rawDoc = process.env.LEDGER_DOC_ID?.trim() || "state";
const NS = rawDoc === "state" ? "" : `${rawDoc}__`;

export const WORD_POOL = `${NS}wordPool`;
export const PARAGRAPH_POOL = `${NS}paragraphPool`;
export const GAME_SESSIONS = `${NS}gameSessions`;

export function gameCollection(name: string) {
  return adminDb.collection(name);
}

export type GameKind = "word" | "type";

/** Tier 0 = free; 1..3 = paid ladder. Throws on anything else. */
export function assertValidTier(tier: number): void {
  if (!Number.isInteger(tier) || tier < 0 || tier > config.games.tierFees.length) {
    throw new LedgerError("BAD_TIER", "Unknown game tier.");
  }
}
