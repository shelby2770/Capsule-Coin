"use client";

import { useBootstrap } from "@/components/BootstrapProvider";

/**
 * Leaderboard (powers the wallet home and the leaderboard page) — served from
 * the shared /api/bootstrap payload.
 */
export function useLeaderboard() {
  const { leaderboard, loading, error, refresh } = useBootstrap();
  return { data: leaderboard, loading, error, refresh };
}
