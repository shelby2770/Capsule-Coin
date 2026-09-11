"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { TransactionPublic } from "@/lib/types";
import { LEDGER_EVENT } from "@/lib/ledgerEvents";

export function useTransactions() {
  const { status, authedFetch } = useAuth();
  const [transactions, setTransactions] = useState<TransactionPublic[] | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/transactions");
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions as TransactionPublic[]);
      }
    } catch {
      /* non-fatal for the activity feed */
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

  return { transactions, loading, refresh };
}
