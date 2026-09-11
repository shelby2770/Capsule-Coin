"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { BalancePoint } from "@/lib/types";
import { LEDGER_EVENT } from "@/lib/ledgerEvents";

export type BalanceRange = "7d" | "30d" | "all";

/** A member's CC balance history for the chart, refreshed on any ledger change. */
export function useBalanceHistory(slug: string, range: BalanceRange) {
  const { status, authedFetch } = useAuth();
  const [series, setSeries] = useState<BalancePoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const res = await authedFetch(`/api/members/${slug}/history?range=${range}`);
      if (res.ok) {
        const data = (await res.json()) as { series: BalancePoint[] };
        setSeries(data.series);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [authedFetch, slug, range]);

  useEffect(() => {
    if (status !== "member" || !slug) return;
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(LEDGER_EVENT, onChange);
    return () => window.removeEventListener(LEDGER_EVENT, onChange);
  }, [status, slug, refresh]);

  return { series, loading, refresh };
}
