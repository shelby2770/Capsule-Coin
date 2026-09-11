"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { ValuePoint } from "@/lib/types";
import { LEDGER_EVENT } from "@/lib/ledgerEvents";

export type ValueRange = "24h" | "7d" | "all";

/** ৳/CC value history for the chart, refreshed on any ledger change. */
export function useValueHistory(range: ValueRange) {
  const { status, authedFetch } = useAuth();
  const [series, setSeries] = useState<ValuePoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/value/history?range=${range}`);
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
