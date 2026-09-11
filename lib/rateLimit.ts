import "server-only";

/**
 * Tiny in-memory sliding-window rate limiter for anti-bot protection. Tracks
 * recent hits per key; once `limit` hits occur within `windowMs`, the key is
 * blocked for `blockMs` (a temporary "ban"). Per server instance — fine for a
 * small closed group; swap for a shared store if ever horizontally scaled.
 */
type Bucket = { hits: number[]; blockedUntil: number };
// globalThis-backed so limits are shared across route modules / survive HMR.
const g = globalThis as unknown as { __cpcRateBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> =
  g.__cpcRateBuckets ?? (g.__cpcRateBuckets = new Map());

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  blockMs: number,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { hits: [], blockedUntil: 0 };
    buckets.set(key, b);
  }
  if (b.blockedUntil > now) {
    return { ok: false, retryAfterMs: b.blockedUntil - now };
  }
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    b.blockedUntil = now + blockMs;
    b.hits = [];
    return { ok: false, retryAfterMs: blockMs };
  }
  b.hits.push(now);
  return { ok: true, retryAfterMs: 0 };
}
