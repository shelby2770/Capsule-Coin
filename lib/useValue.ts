"use client";

import { useBootstrap } from "@/components/BootstrapProvider";

/** CC value report — served from the shared /api/bootstrap payload. */
export function useValue() {
  const { value, loading, refresh } = useBootstrap();
  return { data: value, loading, refresh };
}
