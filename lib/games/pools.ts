import "server-only";

import { randomInt } from "crypto";
import { adminDb } from "@/lib/firebase/admin";
import { LedgerError } from "@/lib/excel/store";
import { config } from "@/lib/config";
import {
  gameCollection,
  WORD_POOL,
  PARAGRAPH_POOL,
  PROBLEM_POOL,
  MCQ_POOL,
} from "@/lib/games/common";

/** Fisher–Yates shuffle (crypto-random), non-mutating. */
function shuffled<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Word pool ────────────────────────────────────────────────────────────────
// Stored as one doc per length: wordPool/len5 = { words: string[] }, etc. Words
// are consumed ONCE — popped out of the array when served — so a word is never
// reused. Kept as arrays (not one doc per word) so the whole pool is a couple of
// small docs (thousands of 5–6 letter words ≈ tens of KB, well under 1 MiB).

const wordDoc = (len: number) => gameCollection(WORD_POOL).doc(`len${len}`);

/**
 * Atomically pull `count` unused words (each removed from the pool) drawn across
 * the given lengths. Returns lowercase words. Throws POOL_EMPTY if the pool can't
 * cover the request.
 */
export async function consumeWords(
  count: number,
  lengths: readonly number[],
): Promise<string[]> {
  if (count <= 0) return [];
  return adminDb.runTransaction(async (tx) => {
    const refs = lengths.map((n) => wordDoc(n));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const arrays: string[][] = snaps.map((s) => {
      const w = s.exists ? (s.data()?.words as unknown) : null;
      return Array.isArray(w) ? [...(w as string[])] : [];
    });

    const total = arrays.reduce((a, arr) => a + arr.length, 0);
    if (total < count) {
      throw new LedgerError(
        "POOL_EMPTY",
        "Not enough words are ready just yet — please check back soon.",
      );
    }

    const chosen: string[] = [];
    for (let i = 0; i < count; i++) {
      const withWords = arrays
        .map((arr, idx) => ({ arr, idx }))
        .filter((x) => x.arr.length > 0);
      const pick = withWords[randomInt(withWords.length)];
      const wi = randomInt(pick.arr.length);
      chosen.push(String(pick.arr[wi]).toLowerCase());
      pick.arr.splice(wi, 1);
    }

    // Persist only the docs we actually drew from.
    refs.forEach((ref, k) => tx.set(ref, { words: arrays[k] }, { merge: true }));
    return chosen;
  });
}

/** Total words left across the given lengths (for the hub's "words left" stat). */
export async function remainingWordCount(lengths: readonly number[]): Promise<number> {
  const snaps = await Promise.all(lengths.map((n) => wordDoc(n).get()));
  return snaps.reduce((a, s) => {
    const w = s.exists ? (s.data()?.words as unknown) : null;
    return a + (Array.isArray(w) ? w.length : 0);
  }, 0);
}

// ── Paragraph pool ───────────────────────────────────────────────────────────
// paragraphPool/d1 .. d5 = { paragraphs: [{ id, text }] } (higher d = harder).
// Paragraphs are REUSED (picked at random, not consumed) — only words are
// used-once. If a difficulty has no paragraphs, fall back to the nearest one.

export type PoolParagraph = { id: string; text: string; difficulty: number };

const DIFFICULTIES = [5, 4, 3, 2, 1];

/**
 * Total typing passages available across all difficulties (for the hub's
 * "passages" stat). Paragraphs are REUSED (not consumed), so this is the pool
 * size — a stable inventory count, not a countdown like the word pool.
 */
export async function remainingParagraphCount(): Promise<number> {
  const snaps = await Promise.all(
    DIFFICULTIES.map((d) => gameCollection(PARAGRAPH_POOL).doc(`d${d}`).get()),
  );
  return snaps.reduce((a, s) => {
    const p = s.exists ? (s.data()?.paragraphs as unknown) : null;
    return a + (Array.isArray(p) ? p.length : 0);
  }, 0);
}

// ── Problem pool ───────────────────────────────────────────────────────────────
// problemPool/<topic> = { problems: [{ id, title, statement, difficulty }] }, one
// doc per topic (config.games.problem.topics). Problems are used ONCE — the served
// problem is removed from its topic bucket (like words), so nobody sees a repeat.

export type PoolProblem = {
  id: string;
  title: string;
  statement: string;
  topic: string;
  difficulty: number;
};

function readProblems(topic: string, data: unknown): PoolProblem[] {
  const raw = (data as { problems?: unknown } | null)?.problems;
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .filter((p) => typeof p?.statement === "string" && (p.statement as string).trim().length > 0)
    .map((p) => ({
      id: String(p.id ?? ""),
      title: String(p.title ?? "Problem"),
      statement: String(p.statement),
      topic,
      difficulty: Number(p.difficulty ?? 1) || 1,
    }));
}

/**
 * Atomically pull ONE unused problem from a single bucket (removed from the pool
 * so it's never served again). The bucket is the free key for the free tier, or a
 * topic for a paid tier. Throws POOL_EMPTY if that bucket is empty.
 */
export async function consumeProblem(bucket: string): Promise<PoolProblem> {
  return adminDb.runTransaction(async (tx) => {
    const ref = gameCollection(PROBLEM_POOL).doc(bucket);
    const snap = await tx.get(ref);
    const list = snap.exists ? readProblems(bucket, snap.data()) : [];
    if (list.length === 0) {
      throw new LedgerError(
        "POOL_EMPTY",
        "No problems are available just yet — please check back soon.",
      );
    }
    const chosen = list[randomInt(list.length)];
    // Remove the chosen problem from its bucket by id (the rest kept intact).
    const raw = snap.data()?.problems;
    const rawArr = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
    const remaining = rawArr.filter(
      (p) => String((p as { id?: unknown }).id ?? "") !== chosen.id,
    );
    tx.set(ref, { problems: remaining }, { merge: true });
    return chosen;
  });
}

/** Total problems left across the free bucket + every topic (hub's "problems" stat). */
export async function remainingProblemCount(): Promise<number> {
  const buckets = [config.games.problem.freeKey, ...config.games.problem.topics];
  const snaps = await Promise.all(buckets.map((t) => gameCollection(PROBLEM_POOL).doc(t).get()));
  return snaps.reduce((a, s, i) => a + (s.exists ? readProblems(buckets[i], s.data()).length : 0), 0);
}

/**
 * Topics that currently have at least one problem — the list offered when a paid
 * tier lets the player pick a topic. Empty topics are hidden so a pick can't land
 * on an empty bucket.
 */
export async function availableProblemTopics(): Promise<string[]> {
  const topics = [...config.games.problem.topics];
  const snaps = await Promise.all(topics.map((t) => gameCollection(PROBLEM_POOL).doc(t).get()));
  return topics.filter((t, i) => snaps[i].exists && readProblems(t, snaps[i].data()).length > 0);
}

// ── MCQ pool (AI Blitz) ─────────────────────────────────────────────────────────
// mcqPool/all = { questions: [{ id, question, options: string[4], answer: 0..3,
// topic }] }. Questions are used ONCE — the drawn questions are removed from the
// pool (like words), so nobody sees a repeat. The `answer` index is server-only —
// the board view strips it before anything reaches the client.

export type PoolMcq = {
  id: string;
  question: string;
  options: string[];
  answer: number; // correct option index (server-only)
  topic: string;
  explanation?: string; // shown in the end-of-round review (server-only until submit)
};

const MCQ_DOC = "all";

function readMcqs(data: unknown): PoolMcq[] {
  const raw = (data as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .filter(
      (q) =>
        typeof q?.question === "string" &&
        Array.isArray(q?.options) &&
        (q.options as unknown[]).length >= 2 &&
        Number.isInteger(q?.answer) &&
        (q.answer as number) >= 0 &&
        (q.answer as number) < (q.options as unknown[]).length,
    )
    .map((q) => ({
      id: String(q.id ?? ""),
      question: String(q.question),
      options: (q.options as unknown[]).map((o) => String(o)),
      answer: Number(q.answer),
      topic: String(q.topic ?? "ai"),
      explanation: typeof q.explanation === "string" ? q.explanation : undefined,
    }));
}

/**
 * Atomically pull `n` unused MCQs (with their answers, server-side) and remove
 * them from the pool so they're never served again. Throws POOL_EMPTY if short.
 */
export async function consumeMcqs(n: number): Promise<PoolMcq[]> {
  if (n <= 0) return [];
  return adminDb.runTransaction(async (tx) => {
    const ref = gameCollection(MCQ_POOL).doc(MCQ_DOC);
    const snap = await tx.get(ref);
    const raw = snap.exists ? snap.data()?.questions : null;
    const rawArr = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
    const all = readMcqs({ questions: rawArr });
    if (all.length < n) {
      throw new LedgerError(
        "POOL_EMPTY",
        "Not enough quiz questions are ready just yet — please check back soon.",
      );
    }
    const picked = shuffled(all).slice(0, n);
    const pickedIds = new Set(picked.map((q) => q.id));
    // Remove the drawn questions from the raw array by id (rest kept intact).
    const remaining = rawArr.filter(
      (q) => !pickedIds.has(String((q as { id?: unknown }).id ?? "")),
    );
    tx.set(ref, { questions: remaining }, { merge: true });
    return picked;
  });
}

/** Total MCQs available (for the hub's "questions" stat). */
export async function remainingMcqCount(): Promise<number> {
  const snap = await gameCollection(MCQ_POOL).doc(MCQ_DOC).get();
  return snap.exists ? readMcqs(snap.data()).length : 0;
}

export async function pickParagraph(difficulty: number): Promise<PoolParagraph> {
  const order = [difficulty, ...DIFFICULTIES.filter((d) => d !== difficulty)];
  for (const d of order) {
    const snap = await gameCollection(PARAGRAPH_POOL).doc(`d${d}`).get();
    const raw = snap.exists ? (snap.data()?.paragraphs as unknown) : null;
    const arr = Array.isArray(raw)
      ? (raw as Array<{ id?: string; text?: string }>).filter(
          (p) => typeof p?.text === "string" && p.text.trim().length > 0,
        )
      : [];
    if (arr.length > 0) {
      const p = arr[randomInt(arr.length)];
      return { id: String(p.id ?? ""), text: String(p.text), difficulty: d };
    }
  }
  throw new LedgerError(
    "POOL_EMPTY",
    "No typing passages are available just yet — please check back soon.",
  );
}
