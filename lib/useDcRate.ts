"use client";

import { useBootstrap } from "@/components/BootstrapProvider";

/** DC -> CC market-rate report — served from the shared /api/bootstrap payload. */
export function useDcRate() {
  const { dcRate, loading, refresh } = useBootstrap();
  return { data: dcRate, loading, refresh };
}
