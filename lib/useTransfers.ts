"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { TransfersResponse } from "@/lib/types";
import { LEDGER_EVENT } from "@/lib/ledgerEvents";

export function useTransfers() {
  const { status, authedFetch } = useAuth();
  const [data, setData] = useState<TransfersResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await authedFetch("/api/transfers");
      if (res.ok) setData((await res.json()) as TransfersResponse);
    } catch {
      /* non-fatal */
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

  return { data, loading, refresh };
}
