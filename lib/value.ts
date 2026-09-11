import "server-only";

import { config } from "@/lib/config";
import type { LedgerState } from "@/lib/excel/store";

/**
 * Capsule Coin value.
 *
 * Fiat rate (headline): rises with how spread-out balances are — the standard
 * deviation of everyone's holdings — squashed into a bounded [min, max] BDT band.
 * A quiet market (everyone near 0) sits at the floor; an active market with big
 * winners and debtors pushes the rate toward the ceiling. Never leaves the band.
 *
 *   σ        = stddev(current member balances)
 *   bdtPerCC = min + (max - min) · (1 - e^(-σ / spreadScale))
 *   usdPerCC = bdtPerCC / usdBdtRate
 *
 * A Scarcity/Demand index (k·Demand/Supply) is also kept as a secondary metric.
 * Everything is reconstructed from the timestamped ledger, so any past point can
 * be recomputed exactly — no extra storage.
 */
const DAY = 86_400_000;

// ── Scarcity index (secondary) ──────────────────────────────────────────────
function supplyAt(state: LedgerState, t: number): number {
  let s = 0;
  for (const tx of state.transactions) {
    const ts = Date.parse(tx.createdAt);
    if (Number.isNaN(ts) || ts > t) continue;
    if (tx.type === "MINE") s += tx.amountCC;
    else if (tx.type === "BURN") s -= tx.amountCC;
    else if (tx.type === "ADJUST") s += tx.toEmail ? tx.amountCC : -tx.amountCC;
  }
  return s;
}

function demandAt(state: LedgerState, t: number): number {
  const from = t - config.value.windowDays * DAY;
  let volume = 0;
  for (const tx of state.transactions) {
    if (tx.type !== "TRADE") continue;
    const ts = Date.parse(tx.createdAt);
    if (Number.isNaN(ts) || ts > t || ts <= from) continue;
    volume += tx.amountCC;
  }
  let escrow = 0;
  for (const o of state.offers) {
    if (o.type !== "BUY") continue;
    const created = Date.parse(o.createdAt);
    if (Number.isNaN(created) || created > t) continue;
    const closed = o.closedAt ? Date.parse(o.closedAt) : NaN;
    const openAtT = Number.isNaN(closed) ? true : closed > t;
    if (openAtT) escrow += o.priceCC;
  }
  return volume + escrow;
}

function indexAt(state: LedgerState, t: number): number {
  const supply = supplyAt(state, t);
  const demand = demandAt(state, t);
  const raw = supply > 0 ? (config.value.k * demand) / supply : 0;
  return Number(raw.toFixed(2));
}

// ── Fiat rate (headline) — spread-based ─────────────────────────────────────
/** Reconstruct every current member's balance as of time t from the ledger. */
function balancesAt(state: LedgerState, t: number): number[] {
  const bal = new Map<string, number>(state.members.map((m) => [m.email, 0]));
  for (const tx of state.transactions) {
    const ts = Date.parse(tx.createdAt);
    if (Number.isNaN(ts) || ts > t) continue;
    if (tx.toEmail && bal.has(tx.toEmail)) bal.set(tx.toEmail, (bal.get(tx.toEmail) ?? 0) + tx.amountCC);
    if (tx.fromEmail && bal.has(tx.fromEmail)) bal.set(tx.fromEmail, (bal.get(tx.fromEmail) ?? 0) - tx.amountCC);
  }
  return [...bal.values()];
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function bdtAt(state: LedgerState, t: number): number {
  const { bdtMin, bdtMax, spreadScale, power } = config.value;
  const sigma = stddev(balancesAt(state, t));
  const rate01 = 1 - Math.exp(-sigma / (spreadScale || 1));
  const raw = bdtMin + (bdtMax - bdtMin) * rate01;
  // Compress the raw band with a root so the coin reads calmer (see config).
  return Math.pow(raw, power);
}

// ── Report ──────────────────────────────────────────────────────────────────
export function valueReport(state: LedgerState, now: number) {
  const bdtNow = bdtAt(state, now);
  const bdtPrev = bdtAt(state, now - DAY);
  const bdtPerCC = Number(bdtNow.toFixed(2));
  const usdPerCC = Number((bdtPerCC / config.value.usdBdtRate).toFixed(4));
  // Only report a 24h change once the ledger has ≥24h of real history —
  // before that the "24h ago" baseline is all-zeros and the % is meaningless
  // (it would read as a giant fake jump right after launch). Show "new" instead.
  const hasDayHistory = state.transactions.some(
    (t) => Date.parse(t.createdAt) <= now - DAY,
  );
  const change24h =
    hasDayHistory && bdtPrev > 0
      ? Number((((bdtNow - bdtPrev) / bdtPrev) * 100).toFixed(1))
      : null;
  const spread = Number(stddev(balancesAt(state, now)).toFixed(1));

  const points = 24;
  const series: Array<{ t: number; value: number }> = [];
  for (let i = points; i >= 0; i--) {
    const t = now - i * (DAY / points);
    series.push({ t, value: Number(bdtAt(state, t).toFixed(2)) });
  }

  return {
    bdtPerCC,
    usdPerCC,
    usdBdtRate: config.value.usdBdtRate,
    change24h,
    spread,
    index: indexAt(state, now),
    supply: supplyAt(state, now),
    demand: demandAt(state, now),
    k: config.value.k,
    windowDays: config.value.windowDays,
    balanceFloor: config.balanceFloor,
    series,
  };
}

/** Timestamp (ms) of the earliest ledger transaction, or null if the ledger is empty. */
export function firstTxTime(state: LedgerState): number | null {
  let min = Infinity;
  for (const tx of state.transactions) {
    const ts = Date.parse(tx.createdAt);
    if (!Number.isNaN(ts) && ts < min) min = ts;
  }
  return Number.isFinite(min) ? min : null;
}

/**
 * One member's CC balance over time, sampled at `points`+1 evenly-spaced instants
 * between fromMs and now. Reconstructed exactly from the ledger: every member
 * starts at 0 and opening balances are ledger transactions, so summing this
 * member's tx deltas up to each sample gives their balance then.
 */
export function balanceHistoryFor(
  state: LedgerState,
  email: string,
  now: number,
  fromMs: number,
  points = 60,
): Array<{ t: number; balance: number }> {
  const events: Array<{ ts: number; delta: number }> = [];
  for (const tx of state.transactions) {
    const ts = Date.parse(tx.createdAt);
    if (Number.isNaN(ts)) continue;
    let delta = 0;
    if (tx.toEmail === email) delta += tx.amountCC;
    if (tx.fromEmail === email) delta -= tx.amountCC;
    if (delta !== 0) events.push({ ts, delta });
  }
  events.sort((a, b) => a.ts - b.ts);

  const span = Math.max(1, now - fromMs);
  const out: Array<{ t: number; balance: number }> = [];
  let idx = 0;
  let running = 0;
  for (let i = 0; i <= points; i++) {
    const t = Math.round(fromMs + (span * i) / points);
    while (idx < events.length && events[idx].ts <= t) {
      running += events[idx].delta;
      idx++;
    }
    out.push({ t, balance: Number(running.toFixed(2)) });
  }
  return out;
}

/**
 * A ৳/CC series between two times, sampled at `points`+1 evenly-spaced instants.
 * Each sample is reconstructed exactly from the ledger (no stored history).
 */
export function valueHistory(
  state: LedgerState,
  now: number,
  fromMs: number,
  points = 48,
): Array<{ t: number; value: number }> {
  const span = Math.max(1, now - fromMs);
  const out: Array<{ t: number; value: number }> = [];
  for (let i = 0; i <= points; i++) {
    const t = Math.round(fromMs + (span * i) / points);
    out.push({ t, value: Number(bdtAt(state, t).toFixed(2)) });
  }
  return out;
}
