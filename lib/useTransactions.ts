"use client";

import { useBootstrap } from "@/components/BootstrapProvider";

/** The caller's transaction history — served from the shared /api/bootstrap payload. */
export function useTransactions() {
  const { transactions, loading, refresh } = useBootstrap();
  return { transactions, loading, refresh };
}
