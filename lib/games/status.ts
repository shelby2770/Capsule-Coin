import "server-only";

import { config } from "@/lib/config";
import { arcadeGate } from "@/lib/excel/store";
import { remainingWordCount } from "@/lib/games/pools";
import { activeSessionFor } from "@/lib/games/sessions";
import type { ArcadeStatus } from "@/lib/types";

/** Everything the Arcade hub needs: the shared gate + pool + resumable game. */
export async function arcadeStatus(email: string): Promise<ArcadeStatus> {
  const gate = await arcadeGate(email);
  const [wordsRemaining, wordSession] = await Promise.all([
    remainingWordCount(config.games.word.lengths),
    // Only word games are resumable — a timed race can't be paused, so an
    // abandoned type session is forfeit rather than offered back.
    activeSessionFor(email, "word"),
  ]);
  const resumable = wordSession ? { kind: "word" as const, sessionId: wordSession.id } : null;

  return {
    ...gate,
    wordsRemaining,
    wordCounts: [...config.games.word.counts],
    resumable,
  };
}
