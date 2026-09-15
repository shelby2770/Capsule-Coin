"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { ValuePoint } from "@/lib/types";
import { LEDGER_EVENT } from "@/lib/ledgerEvents";

export type DcRateRange = "24h" | "7d" | "all";

/** DC->CC per-DC rate history for the chart, refreshed on any ledger change. */
export function useDcRateHistory(range: DcRateRange) {
  const { status, authedFetch } = useAuth();
  const [series, setSeries] = useState<ValuePoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/dc/rate/history?range=${range}`);
      if (res.ok) {
        const data = (await res.json()) as { series: ValuePoint[] };
        setSeries(data.series);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [authedFetch, range]);

  useEffect(() => {
    if (status !== "member") return;
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(LEDGER_EVENT, onChange);
    return () => window.removeEventListener(LEDGER_EVENT, onChange);
  }, [status, refresh]);

  return { series, loading, refresh };
}
