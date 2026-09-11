"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { ValueResponse } from "@/lib/types";
import { LEDGER_EVENT } from "@/lib/ledgerEvents";

export function useValue() {
  const { status, authedFetch } = useAuth();
  const [data, setData] = useState<ValueResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await authedFetch("/api/value");
      if (res.ok) setData((await res.json()) as ValueResponse);
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
