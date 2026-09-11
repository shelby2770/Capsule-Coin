"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { OfferPublic } from "@/lib/types";

export function useOffers() {
  const { status, authedFetch } = useAuth();
  const [offers, setOffers] = useState<OfferPublic[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/offers");
      if (!res.ok) throw new Error(`Failed to load offers (${res.status})`);
      const data = await res.json();
      setOffers(data.offers as OfferPublic[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load offers");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (status === "member") void refresh();
  }, [status, refresh]);

  return { offers, loading, error, refresh };
}
