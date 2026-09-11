"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { LeaderboardResponse } from "@/lib/types";
import { LEDGER_EVENT } from "@/lib/ledgerEvents";

/**
 * Fetches the leaderboard (powers both the wallet home and the leaderboard page).
 */
export function useLeaderboard() {
  const { status, authedFetch } = useAuth();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/leaderboard");
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      setData((await res.json()) as LeaderboardResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (status !== "member") return;
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(LEDGER_EVENT, onChange);
    return () => window.removeEventListener(LEDGER_EVENT, onChange);
  }, [status, refresh]);

  return { data, loading, error, refresh };
}
