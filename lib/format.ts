/**
 * Shared money helpers (client-safe — usable in both server and client code).
 * CC is a 2-decimal-place currency: transfers are usually whole, but mining
 * pays out fractional cents, so balances can carry two decimals.
 */

/**
 * Balances at or below this warn the member they're getting close to the −500
 * floor (shown as a flag on the leaderboard and an alert on the wallet).
 */
export const BALANCE_WARN = -400;

/** Round to 2 decimal places, avoiding binary float drift (e.g. 4.005 -> 4.01). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Format a CC amount for display: whole numbers show plainly (128, 1,234),
 * fractional ones show exactly two decimals (3.67, 1,234.50).
 */
export function formatCC(n: number): string {
  const r = round2(n);
  return Number.isInteger(r)
    ? r.toLocaleString()
    : r.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}

/** Dark Capsule Coin ticker + emoji used across DC surfaces. */
export const DC_TICKER = "DC";
export const DC_EMOJI = "🔥";

/**
 * Format a DC amount for display. Same 2-decimal rule as CC, but DC can never be
 * negative (enforced in the store), so a stray negative renders as 0.
 */
export function formatDC(n: number): string {
  const r = round2(Math.max(0, n));
  return Number.isInteger(r)
    ? r.toLocaleString()
    : r.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}
