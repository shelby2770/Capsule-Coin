import "server-only";

import { randomInt } from "crypto";
import { adminDb } from "@/lib/firebase/admin";
import { LedgerError } from "@/lib/excel/store";
import { gameCollection, WORD_POOL, PARAGRAPH_POOL } from "@/lib/games/common";

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
        "Not enough words in the pool right now — an admin needs to top it up.",
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
    "No typing paragraphs are available right now — an admin needs to seed them.",
  );
}
