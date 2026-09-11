"use client";

import { useBootstrap } from "@/components/BootstrapProvider";

/** Peer transfer requests — served from the shared /api/bootstrap payload. */
export function useTransfers() {
  const { transfers, loading, refresh } = useBootstrap();
  return { data: transfers, loading, refresh };
}
