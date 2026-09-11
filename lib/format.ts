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
