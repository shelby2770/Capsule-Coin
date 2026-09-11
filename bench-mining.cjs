#!/usr/bin/env node
"use strict";

/**
 * Manual mining benchmark for Capsule Coin.
 *
 * Replicates the EXACT collision-lottery used in production
 * (lib/excel/store.ts -> runLottery + mine) so you can sweep the keyspace N by
 * hand and see a paid pack's real profit/loss distribution. Only the keyspace N
 * varies - every other knob (tokensPerSide, matchMin/Max, rewardCap) is read
 * from the same env/defaults as lib/config.ts.
 *
 *   1 iteration = one full pack: burn the tier fee, run ALL the tier's mines,
 *   sum the rewards.  net = totalReward - fee.
 *
 * Nothing here touches Firestore, the mirror sheet, or the ledger. Pure math.
 *
 * Run (interactive):  node bench-mining.cjs
 * Run (scripted)   :  node bench-mining.cjs --tier 1 --n 995000000 --iters 10000
 *                     (any flag you omit is still asked interactively)
 *
 * Notes on fidelity:
 *  - Only PAID tiers (1/2/3). Paid mines use rewardScale = 1 (the free-tier
 *    reserve taper never applies to paid mining), so it is not modelled here.
 *  - Prod also caps each payout at the remaining reserve: round2(min(reward,
 *    reserve)). Reserve sits near ~1000 and each mine caps at 10, so that clamp
 *    only ever binds in the last few CC of the 1000-CC supply cap. This bench
 *    assumes the reserve is not near-empty (reserve >= rewardCap), which is the
 *    normal case; it does NOT simulate global reserve depletion across packs.
 */

const { randomBytes, randomInt } = require("crypto");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config - mirror of lib/config.ts (same env names + same fallbacks). We also
// read .env.local so a locally-overridden tokensPerSide / match range / cap is
// respected, exactly like `next dev` would. Manual N overrides the tier's
// keyspace regardless of any of this.
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const env = {};
  try {
    const txt = fs.readFileSync(path.join(__dirname, ".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      env[m[1]] = v;
    }
  } catch {
    /* no .env.local - fall back to defaults */
  }
  return env;
}
const FILE_ENV = loadEnvLocal();

function envNum(name, fallback) {
  const raw = process.env[name] ?? FILE_ENV[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const mining = {
  tokensPerSide: envNum("MINING_TOKENS_PER_SIDE", 100_000),
  matchMin: envNum("MINING_MATCH_MIN", 0.1),
  matchMax: envNum("MINING_MATCH_MAX", 0.7),
  rewardCap: envNum("MINING_REWARD_CAP", 10),
  supplyCap: envNum("MINING_SUPPLY_CAP", 1000),
  // Paid ladder: same order + same defaults as lib/config.ts.
  ladder: [
    { tier: 1, fee: 20, mines: 5, keyspace: envNum("MINING_KEYSPACE_TIER1", 995_000_000) },
    { tier: 2, fee: 50, mines: 10, keyspace: envNum("MINING_KEYSPACE_TIER2", 798_000_000) },
    { tier: 3, fee: 100, mines: 20, keyspace: envNum("MINING_KEYSPACE_TIER3", 798_000_000) },
  ],
};

// ---------------------------------------------------------------------------
// Exact copies of the production primitives.
// ---------------------------------------------------------------------------

/** lib/format.ts round2 - round to 2dp without binary-float drift. */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** lib/excel/store.ts randomIntsMod - uniform ints in [0, mod) from 6-byte crypto reads. */
function randomIntsMod(n, mod) {
  const buf = randomBytes(n * 6);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readUIntBE(i * 6, 6) % mod;
  return out;
}

/** lib/excel/store.ts runLottery - one mine. rewardScale is 1 for paid tiers. */
function runLottery(keyspaceN, rewardScale = 1) {
  const size = Math.max(1, Math.floor(mining.tokensPerSide));
  const mod = Math.max(2, Math.floor(keyspaceN));

  const secret = new Set();
  const secretTokens = randomIntsMod(size, mod);
  for (let i = 0; i < size; i++) secret.add(secretTokens[i]);

  const playerTokens = randomIntsMod(size, mod);
  const counted = new Set();
  let matches = 0;
  for (let i = 0; i < size; i++) {
    const t = playerTokens[i];
    if (secret.has(t) && !counted.has(t)) {
      counted.add(t);
      matches++;
    }
  }

  const { matchMin, matchMax, rewardCap } = mining;
  let reward = 0;
  for (let i = 0; i < matches; i++) {
    reward += matchMin + (matchMax - matchMin) * (randomInt(0, 1_000_001) / 1_000_000);
  }
  reward *= rewardScale;
  return { matches, reward: Math.min(reward, rewardCap) };
}

/**
 * One pack (one iteration): run all the tier's mines, round each payout exactly
 * as mine() does, sum them. net = totalReward - fee.
 */
function runPack(tier) {
  let total = 0;
  let matchSum = 0;
  for (let i = 0; i < tier.mines; i++) {
    const { matches, reward } = runLottery(tier.keyspace, 1);
    total += round2(reward); // mine() rounds each mine's payout before crediting
    matchSum += matches;
  }
  total = round2(total);
  return { total, net: round2(total - tier.fee), matchSum };
}

// ---------------------------------------------------------------------------
// Small formatting helpers.
// ---------------------------------------------------------------------------
const grp = (n) => n.toLocaleString("en-US");
const cc = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + " CC";
const pct = (n) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";

// ---------------------------------------------------------------------------
// Interactive prompts.
// ---------------------------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));

// Optional CLI flags (any subset). Whatever is missing is asked interactively.
function parseFlags() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const grab = () => a[++i];
    if (k === "--tier" || k === "-t") out.tier = grab();
    else if (k === "--n" || k === "-n") out.n = grab();
    else if (k === "--iters" || k === "--iterations" || k === "-i") out.iters = grab();
  }
  return out;
}
const FLAGS = parseFlags();

async function askTier() {
  if (FLAGS.tier !== undefined) {
    const t = mining.ladder.find((x) => String(x.tier) === String(FLAGS.tier).trim());
    if (t) return { ...t };
    console.log(`  ! --tier ${FLAGS.tier} is not 1/2/3; asking instead.`);
  }
  console.log("\nWhich paid tier do you want to benchmark?\n");
  for (const t of mining.ladder) {
    console.log(
      `  ${t.tier})  Tier ${t.tier} - burn ${t.fee} CC, ${t.mines} mines/pack ` +
        `(current N = ${grp(t.keyspace)})`,
    );
  }
  while (true) {
    const a = await ask("\nTier [1/2/3]: ");
    const t = mining.ladder.find((x) => String(x.tier) === a);
    if (t) return { ...t };
    console.log("  ! Enter 1, 2, or 3.");
  }
}

async function askN(tier) {
  if (FLAGS.n !== undefined) {
    const n = Number(String(FLAGS.n).replace(/[_,\s]/g, ""));
    if (Number.isFinite(n) && n >= 2) return Math.floor(n);
    console.log(`  ! --n ${FLAGS.n} is invalid; asking instead.`);
  }
  console.log(
    `\nSet the keyspace N to test (bigger N = fewer matches = leaner mine).` +
      `\nPress Enter to use tier ${tier.tier}'s current value, ${grp(tier.keyspace)}.`,
  );
  while (true) {
    const a = await ask("N: ");
    if (a === "") return tier.keyspace;
    const n = Number(a.replace(/[_,\s]/g, ""));
    if (Number.isFinite(n) && n >= 2) return Math.floor(n);
    console.log("  ! Enter a whole number >= 2 (commas/underscores ok), or Enter for the default.");
  }
}

async function askIterations() {
  if (FLAGS.iters !== undefined) {
    const n = Number(String(FLAGS.iters).replace(/[_,\s]/g, ""));
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 1) return n;
    console.log(`  ! --iters ${FLAGS.iters} is invalid; asking instead.`);
  }
  console.log(
    `\nHow many iterations (packs) to simulate?` +
      `\nEach iteration = one full pack (all of the tier's mines).`,
  );
  while (true) {
    const a = await ask("Iterations: ");
    const n = Number(a.replace(/[_,\s]/g, ""));
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 1) return n;
    console.log("  ! Enter a whole number >= 1.");
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
(async () => {
  console.log("======================================================");
  console.log("  Capsule Coin - mining pack benchmark (paid tiers)");
  console.log("======================================================");
  console.log(
    `  tokensPerSide=${grp(mining.tokensPerSide)}  ` +
      `match=U(${mining.matchMin}, ${mining.matchMax}) CC  ` +
      `cap=${mining.rewardCap} CC/mine`,
  );

  const tier = await askTier();
  const N = await askN(tier);
  const iterations = await askIterations();
  tier.keyspace = N; // apply the manual override

  // Theoretical anchor (ignores the per-mine cap, so real mean is a touch lower).
  const size = Math.floor(mining.tokensPerSide);
  const expMatches = (size * size) / N;
  const expPerMine = expMatches * ((mining.matchMin + mining.matchMax) / 2);
  const expPackReward = expPerMine * tier.mines;
  const expNet = expPackReward - tier.fee;

  console.log("\n------------------------------------------------------");
  console.log(
    `  Tier ${tier.tier}: fee ${tier.fee} CC, ${tier.mines} mines/pack` +
      `   N = ${grp(N)}   iterations = ${grp(iterations)}`,
  );
  console.log(
    `  Theoretical (pre-cap): ~${expMatches.toFixed(2)} matches/mine, ` +
      `~${expPerMine.toFixed(2)} CC/mine, ~${expPackReward.toFixed(2)} CC/pack ` +
      `-> net ~${cc(expNet)}`,
  );
  console.log("------------------------------------------------------\n");

  const totalMines = iterations * tier.mines;
  if (totalMines > 200_000) {
    console.log(
      `  (heads up: ${grp(totalMines)} total mines at ${grp(size)} tokens each - ` +
        `this may take a bit)\n`,
    );
  }

  // Stats. We keep the full net array only for median/percentiles; guard huge runs.
  const keepAll = iterations <= 2_000_000;
  const nets = keepAll ? new Array(iterations) : null;

  let sumNet = 0;
  let sumReward = 0;
  let sumMatches = 0;
  let wins = 0; // net > 0
  let breakEvenPlus = 0; // net >= 0
  let maxNet = -Infinity;
  let minNet = Infinity;
  let maxReward = -Infinity;
  let minReward = Infinity;

  const t0 = Date.now();
  const updateEvery = Math.max(1, Math.floor(iterations / 1000)); // ~<=1000 redraws

  for (let i = 0; i < iterations; i++) {
    const { total, net, matchSum } = runPack(tier);

    sumNet += net;
    sumReward += total;
    sumMatches += matchSum;
    if (net > 0) wins++;
    if (net >= 0) breakEvenPlus++;
    if (net > maxNet) maxNet = net;
    if (net < minNet) minNet = net;
    if (total > maxReward) maxReward = total;
    if (total < minReward) minReward = total;
    if (nets) nets[i] = net;

    if (i % updateEvery === 0 || i === iterations - 1) {
      process.stdout.write(`\r  running iteration ${grp(i + 1)} / ${grp(iterations)} ...`);
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(`\r  ran ${grp(iterations)} iterations in ${secs}s${" ".repeat(20)}\n`);

  const avgNet = sumNet / iterations;
  const avgReward = sumReward / iterations;
  const avgMatchesPerMine = sumMatches / totalMines;
  const winRate = (wins / iterations) * 100;
  const bePlusRate = (breakEvenPlus / iterations) * 100;

  let median = null;
  if (nets) {
    nets.sort((a, b) => a - b);
    const mid = Math.floor(nets.length / 2);
    median = nets.length % 2 ? nets[mid] : (nets[mid - 1] + nets[mid]) / 2;
  }

  const asPct = (net) => (net / tier.fee) * 100;

  console.log("\n======================================================");
  console.log(`  RESULTS - Tier ${tier.tier}  (fee ${tier.fee} CC, ${tier.mines} mines/pack)`);
  console.log(`  N = ${grp(N)}   iterations = ${grp(iterations)}`);
  console.log("======================================================");
  console.log(`  Max profit :  ${cc(maxNet)}   (${pct(asPct(maxNet))})`);
  console.log(`  Max loss   :  ${cc(minNet)}   (${pct(asPct(minNet))})`);
  console.log(`  Average    :  ${cc(avgNet)}   (${pct(asPct(avgNet))})  net per pack`);
  if (median !== null) {
    console.log(`  Median     :  ${cc(median)}   (${pct(asPct(median))})`);
  }
  console.log("  ----------------------------------------------------");
  console.log(`  Win rate   :  ${winRate.toFixed(1)}%   (packs that netted > 0)`);
  console.log(`  Break-even+:  ${bePlusRate.toFixed(1)}%   (packs that netted >= 0)`);
  console.log(
    `  Reward/pack:  avg ${avgReward.toFixed(2)} CC  ` +
      `(min ${minReward.toFixed(2)} / max ${maxReward.toFixed(2)}, before -${tier.fee} fee)`,
  );
  console.log(`  Matches    :  avg ${avgMatchesPerMine.toFixed(2)} per mine`);
  console.log("======================================================");
  console.log("  % is net relative to the burned fee. Max loss floors at");
  console.log("  -100% (a pack can never lose more than the fee it burned).\n");

  rl.close();
})().catch((e) => {
  console.error("\nERROR:", e && e.message ? e.message : e);
  process.exit(1);
});
