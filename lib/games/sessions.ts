import "server-only";

import { randomUUID } from "crypto";
import { gameCollection, GAME_SESSIONS, type GameKind } from "@/lib/games/common";

/**
 * A live game session lives in its own Firestore doc (collection GAME_SESSIONS).
 * It holds server-only secrets (the word answer, server timings) that are NEVER
 * sent to the client — the API returns only feedback. Sessions are short-lived;
 * `status` moves active → done (or abandoned).
 */

export type WordItem = {
  answer: string; // secret, lowercase — never serialized to the client
  length: number;
  servedAt: number; // ms epoch when this word was first shown (timing anchor)
  attempts: string[]; // guesses so far (lowercase)
  solved: boolean;
  failed: boolean; // ran out of attempts
  reward: number; // DC minted for this word (0 until solved)
};

export type TypeItem = {
  id: string;
  text: string; // the target paragraph (also sent to the client — no secret)
  difficulty: number;
  startedAt: number; // ms epoch when served (server timing anchor)
};

export type ProblemItem = {
  id: string;
  title: string;
  statement: string; // shown to the client — reading it IS the game (no secret)
  topic: string;
  difficulty: number;
  startedAt: number; // ms epoch when served; deadline = startedAt + secToSolve
};

export type McqItem = {
  id: string;
  question: string;
  options: string[];
  answer: number; // correct option index — SERVER-ONLY, never serialized to the client
  topic: string;
  explanation?: string; // SERVER-ONLY until submit — revealed in the end-of-round review
};

export type GameSession = {
  id: string;
  email: string;
  kind: GameKind;
  tier: number;
  status: "active" | "done" | "abandoned";
  createdAt: number;
  updatedAt: number;
  totalReward: number;
  // word game
  words?: WordItem[];
  currentIndex?: number;
  maxAttempts?: number;
  // type race
  para?: TypeItem;
  bestWpm?: number; // best WPM across attempts (reward tracks the best run)
  reAttemptsLeft?: number; // free retries remaining on this paid entry
  // problem solving
  problem?: ProblemItem;
  copiedChars?: number; // cumulative statement chars copied (copy-guard tally)
  mark?: number; // grader's mark 0..10 (set on submit)
  // ai blitz
  mcqs?: McqItem[];
  mcqStartedAt?: number; // when the quiz began (server anchor)
  answers?: number[]; // chosen option index per question (-1 = unanswered)
};

const sessionRef = (id: string) => gameCollection(GAME_SESSIONS).doc(id);

export async function createSession(
  data: Omit<GameSession, "id" | "createdAt" | "updatedAt" | "status" | "totalReward"> &
    Partial<Pick<GameSession, "status" | "totalReward">>,
): Promise<GameSession> {
  const now = Date.now();
  const session: GameSession = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "active",
    totalReward: 0,
    ...data,
  };
  await sessionRef(session.id).set(session);
  return session;
}

export async function getSession(id: string): Promise<GameSession | null> {
  const snap = await sessionRef(id).get();
  return snap.exists ? (snap.data() as GameSession) : null;
}

export async function saveSession(session: GameSession): Promise<void> {
  session.updatedAt = Date.now();
  await sessionRef(session.id).set(session);
}

export async function deleteSession(id: string): Promise<void> {
  await sessionRef(id).delete().catch(() => {});
}

/** The most recent still-active session for a member + game kind, if any. */
export async function activeSessionFor(
  email: string,
  kind: GameKind,
): Promise<GameSession | null> {
  const q = await gameCollection(GAME_SESSIONS)
    .where("email", "==", email.trim().toLowerCase())
    .where("kind", "==", kind)
    .where("status", "==", "active")
    .get();
  if (q.empty) return null;
  const rows = q.docs.map((d) => d.data() as GameSession);
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return rows[0];
}

/** Start (ms epoch) of the current UTC day — the daily reset boundary. */
export function startOfUtcDay(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Has the member already entered this game + tier today (UTC)? A session is only
 * persisted once its entry is charged (start deletes it if the charge fails), so
 * counting sessions created today = plays made today. Used to enforce the "one
 * play per paid tier per day, per game" limit. Re-attempts reuse the same session
 * (no new doc), so they don't count as another play. Uses only equality filters
 * (no composite index) and filters the day boundary in memory.
 */
export async function playedTierToday(
  email: string,
  kind: GameKind,
  tier: number,
  now = Date.now(),
): Promise<boolean> {
  const q = await gameCollection(GAME_SESSIONS)
    .where("email", "==", email.trim().toLowerCase())
    .where("kind", "==", kind)
    .where("tier", "==", tier)
    .get();
  if (q.empty) return false;
  const dayStart = startOfUtcDay(now);
  return q.docs.some((d) => Number((d.data() as GameSession).createdAt) >= dayStart);
}
