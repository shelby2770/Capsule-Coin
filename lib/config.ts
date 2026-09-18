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
    // one step per this many NET DC mined. With supplyCap 5000 and step 500 that's
    // 10 brackets, so free reward scales 100% → 10% across the reserve. Paid mines
    // are not tapered. Set step to 0/negative to disable the taper (always full).
    rewardTaperStepCC: num(process.env.MINING_REWARD_TAPER_STEP, 500),
    // Fixed DC reserve: at most this many NET DC can ever be mined into
    // circulation (total mined − converted back). Converting DC→CC reopens
    // headroom, so an active economy keeps mining alive — but total inflation can
    // never exceed this cap. This is what guarantees "no runaway inflation".
    supplyCap: num(process.env.MINING_SUPPLY_CAP, 5000),
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
  // Members may go negative down to this SOFT floor (a shared credit line). Crossing
  // it no longer hard-blocks a spend; it starts a grace countdown (see `grace`).
  balanceFloor: num(process.env.BALANCE_FLOOR, -500),
  // Dark Capsule Coin (DC) — the elite second currency. Mining mints DC; DC is spent
  // on non-food trades (DesertHouse/Gemini-routed) and converts back to CC.
  dc: {
    // DC->CC conversion: CC = x * b(x) * m(S).
    //   b(x) = min(bulkRateMax, bulkFloor + bulkLogGain*ln(x) + bulkTailGain*x^bulkTailPow)
    //          per-DC rate: a low FLOOR for small conversions, a gentle LOGARITHMIC rise
    //          through the middle, and an accelerating POWER-LAW tail so large conversions
    //          keep earning a better rate instead of plateauing (crosses 1.0 CC/DC ~1000
    //          DC, ~2.0 by 2000). Fitted to 1->0.3, 10->0.4, 100->0.5, 500->0.7, 1000->1.0,
    //          1500->1.5, 2000->2.0 (base, before the supply multiplier). Clamped [0, rateMax].
    //   m(S) = clamp((refSupply / S)^supplyGamma, clampMin, clampMax)  — scarcity =
    //          value: MORE total DC in circulation => LESS CC per DC (shown "supply ×N").
    // S = sum of every member's dcBalance. Retune refSupply to the post-migration total.
    bulkFloor: num(process.env.DC_BULK_FLOOR, 0.3), // per-DC rate for the smallest conversions
    bulkLogGain: num(process.env.DC_BULK_LOG_GAIN, 0.04), // gentle log rise through the middle
    bulkTailGain: num(process.env.DC_BULK_TAIL_GAIN, 5.4e-6), // accelerating bulk reward:
    bulkTailPow: num(process.env.DC_BULK_TAIL_POW, 1.64), //   ...bulkTailGain * x^bulkTailPow
    bulkRateMax: num(process.env.DC_BULK_RATE_MAX, 3.0), // safety ceiling on b(x)
    refSupply: num(process.env.DC_REF_SUPPLY, 200),
    supplyGamma: num(process.env.DC_SUPPLY_GAMMA, 0.4),
    clampMin: num(process.env.DC_CLAMP_MIN, 0.5),
    clampMax: num(process.env.DC_CLAMP_MAX, 1.5),
    minConvert: num(process.env.DC_MIN_CONVERT, 1), // smallest DC->CC conversion
    // Buy DC with real money (admin-recorded). 0 = rate not set yet. Proceeds are
    // tallied into the Capsule Fruit Fund, maintained by the Fruit Minister (Jakir).
    bdtPerDc: num(process.env.DC_BDT_PER_DC, 0),
    // Buying DC with taka — a STABLE, generous real-money on-ramp, deliberately
    // decoupled from the volatile CC spread price so ৳100 reliably lands near
    // buyDcPer100 (the whole point: focus on the real value of money). The ৳100
    // buy is the anchor; bigger buys earn a bounded volume bonus on top:
    //   volMult(bdt) = 1 + buyBonusMax·(1 − e^(−bdt/buyBonusScale))
    //   DC(bdt)      = (bdt/100)·buyDcPer100 · volMult(bdt)/volMult(100)
    // ⇒ ৳100 → buyDcPer100 exactly, ৳200 > 2×, ৳500 > 5×, ৳1000 > 10×.
    buyDcPer100: num(process.env.DC_BUY_PER_100, 113),
    buyBonusMax: num(process.env.DC_BUY_BONUS_MAX, 0.5),
    buyBonusScale: num(process.env.DC_BUY_BONUS_SCALE, 500),
    fruitMinisterEmail:
      process.env.FRUIT_MINISTER_EMAIL || "jakir.hossen@orbitax.com",
  },
  // Arcade — earn DC through mini-games (word guessing, type racing) alongside
  // mining. Wins mint DC (tx type GAME) against the SAME fixed mining reserve
  // (config.mining.supplyCap), so total DC inflation stays bounded. A paid entry
  // burns CC (tx type BURN), mirroring the pay-to-mine ladder.
  games: {
    // One free play per UTC day, SHARED across mining + all games — a free member
    // picks ONE of mining / word / type each day (tracked in Member.freeMinesUsed,
    // reset by applyDailyReset). Paid plays are unlimited.
    freePlaysPerDay: num(process.env.GAMES_FREE_PLAYS_PER_DAY, 1),
    // Pay-to-play ladder: burn CC to play ONE game at a higher tier. Index 0 = tier
    // 1. Tier 0 (free) costs nothing. Mirrors the mining ladder's 20/50/100 CC.
    tierFees: [
      num(process.env.GAMES_TIER1_FEE, 20),
      num(process.env.GAMES_TIER2_FEE, 50),
      num(process.env.GAMES_TIER3_FEE, 100),
    ] as ReadonlyArray<number>,
    word: {
      // Words to guess per tier [free, t1, t2, t3]. Paid tiers show one word at a
      // time; solving one reveals the next.
      counts: [
        num(process.env.GAMES_WORD_COUNT_FREE, 1),
        num(process.env.GAMES_WORD_COUNT_T1, 3),
        num(process.env.GAMES_WORD_COUNT_T2, 5),
        num(process.env.GAMES_WORD_COUNT_T3, 10),
      ] as ReadonlyArray<number>,
      // Word lengths drawn from the pool (Wordle-style clues on 5–6 letters).
      lengths: [5, 6] as ReadonlyArray<number>,
      maxAttempts: num(process.env.GAMES_WORD_MAX_ATTEMPTS, 7),
      // Reward per solved word = baseReward / 2^(attempts−1), then × a time factor.
      // 1 try = baseReward, 2 = half, 3 = quarter …
      baseReward: num(process.env.GAMES_WORD_BASE_REWARD, 100),
      // "Normal" seconds per attempt. If the solve took longer than
      // secPerAttempt × attempts, the reward scales by expected/elapsed, floored
      // at timeFloor (so unusually slow play earns less).
      secPerAttempt: num(process.env.GAMES_WORD_SEC_PER_ATTEMPT, 20),
      timeFloor: num(process.env.GAMES_WORD_TIME_FLOOR, 0.1),
      // Per-tier reward multiplier [free, t1, t2, t3] applied on top of the
      // base (attempts × time) reward — paid tiers pay proportionally more.
      tierRewardMult: [
        num(process.env.GAMES_WORD_MULT_FREE, 1),
        num(process.env.GAMES_WORD_MULT_T1, 1),
        num(process.env.GAMES_WORD_MULT_T2, 1),
        num(process.env.GAMES_WORD_MULT_T3, 1),
      ] as ReadonlyArray<number>,
      // A word session self-ends this many seconds after it starts. The on-screen
      // clock keeps running across leave/return; when it hits the cap the session
      // closes and DC earned so far is finalized.
      sessionTtlSec: num(process.env.GAMES_WORD_SESSION_TTL_SEC, 600),
    },
    type: {
      // Reward by net WPM = baseReward at baseWpm, halving each stepWpm below it,
      // to 0 below minWpm. maxWpm is an anti-cheat sanity ceiling (paste guard).
      baseReward: num(process.env.GAMES_TYPE_BASE_REWARD, 100),
      baseWpm: num(process.env.GAMES_TYPE_BASE_WPM, 100),
      stepWpm: num(process.env.GAMES_TYPE_STEP_WPM, 10),
      minWpm: num(process.env.GAMES_TYPE_MIN_WPM, 40),
      maxWpm: num(process.env.GAMES_TYPE_MAX_WPM, 220),
      // Paragraph difficulty per tier [free, t1, t2, t3]. Pool docs are d1..d5
      // (higher = harder); free tier gets the hardest, paid tiers get easier.
      tierDifficulty: [
        num(process.env.GAMES_TYPE_DIFF_FREE, 5),
        num(process.env.GAMES_TYPE_DIFF_T1, 4),
        num(process.env.GAMES_TYPE_DIFF_T2, 3),
        num(process.env.GAMES_TYPE_DIFF_T3, 2),
      ] as ReadonlyArray<number>,
      // Free re-attempts per paid entry [free, t1, t2, t3]: after finishing a
      // race you may retry (a fresh paragraph, no extra CC) this many times to
      // beat your best. Only an improved best mints more DC (top-up), so retries
      // can raise your reward but never farm it. Free tier gets none.
      reAttempts: [
        num(process.env.GAMES_TYPE_REATTEMPTS_FREE, 0),
        num(process.env.GAMES_TYPE_REATTEMPTS_T1, 1),
        num(process.env.GAMES_TYPE_REATTEMPTS_T2, 2),
        num(process.env.GAMES_TYPE_REATTEMPTS_T3, 3),
      ] as ReadonlyArray<number>,
    },
  },
  // Marketplace offers auto-expire (and are deleted) once they're older than this
  // with no taker — checked lazily whenever offers are listed. Default 2 days.
  offers: {
    ttlMs: num(process.env.OFFER_TTL_MS, 2 * 24 * 60 * 60 * 1000),
  },
  // Credit-floor grace / ban. balanceFloor (above) is the SOFT trigger: cross below
  // it and a graceDays countdown starts; recover to >= it in time or be permanently
  // banned. hardFloor is the absolute stop a single spend may never breach.
  grace: {
    hardFloor: num(process.env.CC_HARD_FLOOR, -1000),
    graceDays: num(process.env.CC_GRACE_DAYS, 3),
  },
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
    // Same guard for real-money DC purchases reported in chat (taka). Buy tiers
    // top out at ৳1000; allow some headroom, reject clearly mis-parsed amounts.
    maxBdt: num(process.env.DESERT_HOUSE_MAX_BDT, 5000),
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
