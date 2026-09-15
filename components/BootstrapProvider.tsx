"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useAuth } from "@/components/AuthProvider";
import type {
  LeaderboardResponse,
  ValueResponse,
  DcRateResponse,
  TransfersResponse,
  TransactionPublic,
  OfferFeedItem,
  NegotiationPublic,
} from "@/lib/types";
import { LEDGER_EVENT } from "@/lib/ledgerEvents";

type BootstrapValue = {
  leaderboard: LeaderboardResponse | null;
  value: ValueResponse | null;
  dcRate: DcRateResponse | null;
  transfers: TransfersResponse | null;
  transactions: TransactionPublic[] | null;
  recentOffers: OfferFeedItem[] | null;
  negotiations: NegotiationPublic[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const EMPTY = {
  leaderboard: null,
  value: null,
  dcRate: null,
  transfers: null,
  transactions: null,
  recentOffers: null,
  negotiations: null,
};

const Ctx = createContext<BootstrapValue | null>(null);

/**
 * Fetches /api/bootstrap once the viewer is a member and re-fetches on any
 * LEDGER_EVENT — one request that powers useLeaderboard/useValue/useTransfers/
 * useTransactions. Collapses the old ~6-request first load to two (/api/me for
 * the auth gate + this). Mounted in the root layout so the shell and every
 * authed page read from the same payload.
 */
export function BootstrapProvider({ children }: { children: React.ReactNode }) {
  const { status, authedFetch } = useAuth();
  const [data, setData] = useState<Omit<BootstrapValue, "loading" | "error" | "refresh">>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authedFetch("/api/bootstrap");
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const d = await res.json();
      setData({
        leaderboard: d.leaderboard ?? null,
        value: d.value ?? null,
        dcRate: d.dcRate ?? null,
        transfers: d.transfers ?? null,
        transactions: d.transactions ?? null,
        recentOffers: d.recentOffers ?? null,
        negotiations: d.negotiations ?? null,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (status !== "member") return;
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(LEDGER_EVENT, onChange);

    // Keep the shared payload fresh so broadcast items — new marketplace offers
    // and incoming transfer requests posted by OTHER members — reach everyone
    // without a manual reload. Refresh when the tab regains focus/visibility,
    // plus a gentle interval while the tab is actually visible (skipped when
    // hidden, so backgrounded tabs don't poll).
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    const poll = setInterval(refreshIfVisible, 120_000);

    return () => {
      window.removeEventListener(LEDGER_EVENT, onChange);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      clearInterval(poll);
    };
  }, [status, refresh]);

  return (
    <Ctx.Provider value={{ ...data, loading, error, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useBootstrap(): BootstrapValue {
  return (
    useContext(Ctx) ?? {
      ...EMPTY,
      loading: true,
      error: null,
      refresh: async () => {},
    }
  );
}
