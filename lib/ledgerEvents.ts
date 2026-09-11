"use client";

/**
 * Lightweight client event so views (value ticker, leaderboard, activity)
 * refresh immediately after any transaction (trade, mine, offer change).
 */
export const LEDGER_EVENT = "cc:ledger-changed";

export function emitLedgerChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LEDGER_EVENT));
  }
}
