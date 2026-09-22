import "server-only";

import { config } from "@/lib/config";
import { arcadeGate } from "@/lib/excel/store";
import {
  remainingWordCount,
  remainingParagraphCount,
  remainingProblemCount,
  remainingMcqCount,
} from "@/lib/games/pools";
import { activeSessionFor } from "@/lib/games/sessions";
import { allGameBans } from "@/lib/games/bans";
import type { ArcadeStatus } from "@/lib/types";

/** Everything the Arcade hub needs: the shared gate + pool + resumable game + bans. */
export async function arcadeStatus(email: string): Promise<ArcadeStatus> {
  const gate = await arcadeGate(email);
  const [wordsRemaining, paragraphsRemaining, problemsRemaining, mcqRemaining, wordSession, bans] =
    await Promise.all([
      remainingWordCount(config.games.word.lengths),
      remainingParagraphCount(),
      remainingProblemCount(),
      remainingMcqCount(),
      // Only word games are resumable — the timed games (type / problem / blitz)
      // can't be paused, so an abandoned session is forfeit rather than offered back.
      activeSessionFor(email, "word"),
      // Per-game copy/screenshot ban times (one read), so each game page can show a
      // lockout without its own round-trip.
      allGameBans(email),
    ]);
  const resumable = wordSession ? { kind: "word" as const, sessionId: wordSession.id } : null;

  return {
    ...gate,
    wordsRemaining,
    paragraphsRemaining,
    problemsRemaining,
    mcqRemaining,
    wordCounts: [...config.games.word.counts],
    resumable,
    bans,
  };
}
