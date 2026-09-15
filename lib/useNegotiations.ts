"use client";

import { useBootstrap } from "@/components/BootstrapProvider";

/** Price negotiations the viewer is part of — from the shared /api/bootstrap payload. */
export function useNegotiations() {
  const { negotiations, loading, refresh } = useBootstrap();
  return { negotiations, loading, refresh };
}
