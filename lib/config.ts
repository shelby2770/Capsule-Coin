import "server-only";

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Server-side economy + ledger configuration. All tunables live in env so the
 * economy can be adjusted without code changes (see .env.example).
 */
export const config = {
  // Mining v2 — a collision-lottery. Each mine draws `tokensPerSide` tokens from
  // a keyspace and rewards the collisions against a secret set of the same size.
  // Expected matches ≈ tokensPerSide² / keyspace; each match pays U(matchMin,
  // matchMax) CC, summed and capped at rewardCap. Since matches ∝ 1/keyspace, a
  // BIGGER keyspace = fewer matches = leaner mine. Free uses the biggest keyspace
  // (rarest). Paid tiers are tuned so each pack is a ~50/50 coin flip — median net
  // ≈ 0 vs the burned fee. Per-mine richness: free < tier1 < tier2 = tier3; tier2
  // and tier3 share the same odds and differ only in how many mines you buy.
  mining: {
    tokensPerSide: num(process.env.MINING_TOKENS_PER_SIDE, 100_000),
    keyspaceFree: num(process.env.MINING_KEYSPACE_FREE, 13_000_000_000), // ~0.77 matches, ~0.42 CC avg
    matchMin: num(process.env.MINING_MATCH_MIN, 0.1),
    matchMax: num(process.env.MINING_MATCH_MAX, 0.7),
    rewardCap: num(process.env.MINING_REWARD_CAP, 10),
    // Free-tier reward taper: keyspace N stays fixed, but the per-match reward
    // range (matchMin..matchMax) scales DOWN as the fixed reserve is mined out —
    // one step per this many NET CC mined. With supplyCap 1000 and step 100 that's
    // 10 brackets, so free reward scales 100% → 10% across the reserve. Paid mines
    // are not tapered. Set step to 0/negative to disable the taper (always full).
    rewardTaperStepCC: num(process.env.MINING_REWARD_TAPER_STEP, 100),
    freePerDay: num(process.env.MINING_FREE_PER_DAY, 3),
    // Fixed supply: at most this many NET CC can ever be mined into circulation
    // (total mined − total burned). Burned pay-to-mine fees recycle headroom, so
    // an active economy keeps mining alive — but total inflation can never exceed
    // this cap. This is what guarantees "no runaway inflation".
    supplyCap: num(process.env.MINING_SUPPLY_CAP, 1000),
    // Pay-to-mine ladder (bought in order, refills daily). Fees are burned. Each
    // tier's keyspace shrinks → progressively richer than free and the tier below.
    ladder: [
      { fee: 20, mines: 5, keyspace: num(process.env.MINING_KEYSPACE_TIER1, 995_000_000) }, // ~10.0 matches, ~4.0 CC/mine — 50/50 net (median ≈ 0) at matchMax 0.7
      { fee: 50, mines: 10, keyspace: num(process.env.MINING_KEYSPACE_TIER2, 798_000_000) }, // ~12.5 matches, ~5.0 CC/mine — 50/50 net
      { fee: 100, mines: 20, keyspace: num(process.env.MINING_KEYSPACE_TIER3, 798_000_000) }, // ~12.5 matches, ~5.0 CC/mine — 50/50 net (same odds as T2, more mines)
    ] as ReadonlyArray<{ fee: number; mines: number; keyspace: number }>,
  },
  value: {
    k: num(process.env.VALUE_K, 100),
    windowDays: num(process.env.VALUE_WINDOW_DAYS, 7),
    // Fiat: rate rises with balance spread (std dev), bounded to [min,max] BDT.
    // bdtPerCC = min + (max-min)*(1 - e^(-stddev/spreadScale)); usd = bdt / usdBdtRate
    bdtMin: num(process.env.CC_BDT_MIN, 0.5),
    bdtMax: num(process.env.CC_BDT_MAX, 10),
    spreadScale: num(process.env.CC_SPREAD_SCALE, 180),
    usdBdtRate: num(process.env.USD_BDT_RATE, 120),
    // The raw spread band [bdtMin,bdtMax] runs a bit hot; take a root of it to
    // compress into a smaller, calmer range (power 0.5 = square root, so a raw
    // ~6 tk reads as ~2.4 tk). 1 = no change.
    power: num(process.env.CC_VALUE_POWER, 0.5),
  },
  // Members may go negative down to this floor (a shared credit line). Configurable.
  balanceFloor: num(process.env.BALANCE_FLOOR, -500),
  transfers: {
    // Pending transfer requests are silently expired after this long with no
    // decision, so stale requests don't linger. Default 2 days.
    ttlMs: num(process.env.TRANSFER_TTL_MS, 2 * 24 * 60 * 60 * 1000),
  },
  // DesertHouse (Google Chat) integration — trades auto-recorded from the space
  // via a Workspace Flow + Gemini, gated by DESERT_HOUSE_TOKEN (a no-op when unset).
  desertHouse: {
    // Reject amounts above this — a guard against mis-parsed free text
    // ("...for 4000 cc"). The largest real trade to date is 300 CC.
    maxCc: num(process.env.DESERT_HOUSE_MAX_CC, 1000),
  },
  // Anti-bot rate limit: more than `max` create-requests within `windowMs`
  // triggers a temporary block ("ban") for `blockMs`.
  rateLimit: {
    max: num(process.env.RATE_LIMIT_MAX, 10),
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    blockMs: num(process.env.RATE_LIMIT_BLOCK_MS, 300_000),
  },
  ledger: {
    path: process.env.LEDGER_XLSX_PATH || "./data/capsule-ledger.xlsx",
    password: process.env.LEDGER_XLSX_PASSWORD || "change-me",
    backupCount: num(process.env.LEDGER_BACKUP_COUNT, 10),
  },
} as const;
