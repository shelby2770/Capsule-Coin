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
