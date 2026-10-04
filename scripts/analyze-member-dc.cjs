#!/usr/bin/env node
/*
 * READ-ONLY. Analyse one member's DC lifecycle and their CC profit/loss from it,
 * over the whole DC era (introduction -> the retirement of DC->CC conversion).
 * Never writes — no --commit, no mutation.
 *
 *   node scripts/analyze-member-dc.cjs --name Shafi
 *   node scripts/analyze-member-dc.cjs --email shafi.kader@orbitax.com
 *   node scripts/analyze-member-dc.cjs --name Shafi --doc capsule_test
 *
 * CC profit/loss from the DC venture =
 *   CC IN   (DC->CC conversions: CONVERT / currency CC, credited to the member)
 *   minus
 *   CC OUT  (only CC that actually bought into DC:
 *              - game entry fees paid in CC  (BURN/CC "…to play…", minted DC)
 *              - mining packs paid in CC AFTER mining started minting DC)
 *
 * EXCLUDED from the P&L (legacy CC-only economy, unrelated to DC):
 *   - legacy mining: mining that cost CC and rewarded CC, i.e. BURN/CC mining-pack
 *     spends dated BEFORE the first MINE/DC row, and the MINE/CC rewards themselves.
 * Also excluded for context: free-mined/won DC (no CC cost) and real-money PURCHASE
 * DC (BDT, not CC). Post-rework DC spends (BURN/DC) are DC-only and don't touch CC.
 *
 * The legacy boundary is the earliest MINE/DC createdAt in the whole ledger — the
 * moment mining flipped from minting CC to minting DC.
 */
const path = require("path");
const admin = require("firebase-admin");

const ROOT = path.join(__dirname, "..");
const svc = require(path.join(ROOT, "capsule-coin-firebase-adminsdk-fbsvc-fea87c9661.json"));
admin.initializeApp({ credential: admin.credential.cert(svc), projectId: "capsule-coin" });
const db = admin.firestore();

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const DOC = opt("doc") || process.env.LEDGER_DOC_ID || "state";
const EMAIL = (opt("email") || "").trim().toLowerCase();
const NAME = (opt("name") || "").trim().toLowerCase();
const r2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;
const cur = (t) => t.currency || "CC";
const day = (s) => String(s || "").slice(0, 10);

if (!EMAIL && !NAME) { console.error("Pick the member: --email <addr> or --name <text>."); process.exit(2); }

(async () => {
  const snap = await db.collection("ledger").doc(DOC).get();
  if (!snap.exists) throw new Error(`No ledger/${DOC}`);
  const state = JSON.parse(snap.data().json);
  const members = state.members || [];
  const txs = [...(state.transactions || [])].sort((a, b) => a.seq - b.seq);

  // resolve member
  let member;
  if (EMAIL) member = members.find((m) => m.email === EMAIL);
  else {
    const matches = members.filter((m) => String(m.name || "").toLowerCase().includes(NAME));
    if (matches.length !== 1) { console.error(`"${NAME}" matched ${matches.length} members — use --email.`); process.exit(1); }
    member = matches[0];
  }
  if (!member) throw new Error(`Member not found.`);
  const email = member.email;

  const to = (t) => t.toEmail === email;
  const from = (t) => t.fromEmail === email;
  const sum = (pred) => r2(txs.filter(pred).reduce((a, t) => a + Number(t.amountCC || 0), 0));
  const count = (pred) => txs.filter(pred).length;

  // legacy boundary: when mining flipped CC -> DC (earliest MINE/DC in the whole ledger)
  const dcMineRows = txs.filter((t) => t.type === "MINE" && cur(t) === "DC");
  const dcMiningStart = dcMineRows.length ? dcMineRows.map((t) => t.createdAt).sort()[0] : null;

  // ── DC earned / spent (context) ──
  const minedDc = sum((t) => t.type === "MINE" && cur(t) === "DC" && to(t));
  const wonDc = sum((t) => t.type === "GAME" && cur(t) === "DC" && to(t));
  const boughtDc = sum((t) => t.type === "PURCHASE" && to(t)); // real money (BDT), not CC
  const spentDc = sum((t) => t.type === "BURN" && cur(t) === "DC" && from(t)); // post-rework play/packs
  const convertedDcOut = sum((t) => t.type === "CONVERT" && cur(t) === "DC" && from(t));

  // ── CC IN: DC->CC conversions ──
  const convRows = txs.filter((t) => t.type === "CONVERT" && cur(t) === "CC" && to(t));
  const ccInConvert = r2(convRows.reduce((a, t) => a + Number(t.amountCC || 0), 0));

  // ── CC OUT: categorise every BURN/CC the member paid ──
  const burnCc = txs.filter((t) => t.type === "BURN" && cur(t) === "CC" && from(t));
  const catOf = (t) => {
    const m = String(t.memo || "").toLowerCase();
    if (m.includes("to play")) return "game";
    if (m.includes("unlock") || m.includes("mining")) return "mining";
    return "other";
  };
  const isLegacyMining = (t) => catOf(t) === "mining" && dcMiningStart && t.createdAt < dcMiningStart;
  const tot = (pred) => r2(burnCc.filter(pred).reduce((a, t) => a + Number(t.amountCC || 0), 0));
  const ccGame = tot((t) => catOf(t) === "game");
  const ccMiningDc = tot((t) => catOf(t) === "mining" && !isLegacyMining(t));
  const ccMiningLegacy = tot(isLegacyMining);
  const ccOther = tot((t) => catOf(t) === "other");

  const ccOutDc = r2(ccGame + ccMiningDc + ccOther);        // counts toward the DC venture
  const netCc = r2(ccInConvert - ccOutDc);                  // legacy mining excluded
  const netGamesOnly = r2(ccInConvert - ccGame);            // if ALL mining CC were excluded
  const legacyMineReward = sum((t) => t.type === "MINE" && cur(t) === "CC" && to(t)); // CC he earned from legacy mining

  const pad = (s, n) => String(s).padEnd(n);
  const money = (x) => `${x >= 0 ? "+" : ""}${x}`;
  console.log(`\nMember: ${member.name} <${email}>`);
  console.log(`Current balances: ${r2(member.balance)} CC · ${r2(member.dcBalance)} DC`);
  console.log(`DC-mining began: ${dcMiningStart ? day(dcMiningStart) : "n/a"} (legacy CC-mining is anything before this)\n`);

  console.log(`── DC acquired (no CC spent to get it) ──────────────`);
  console.log(`  ${pad("Mined (MINE/DC)", 34)} ${String(minedDc).padStart(10)} DC   (${count((t) => t.type === "MINE" && cur(t) === "DC" && to(t))} rows)`);
  console.log(`  ${pad("Won in games (GAME/DC)", 34)} ${String(wonDc).padStart(10)} DC   (${count((t) => t.type === "GAME" && cur(t) === "DC" && to(t))} rows)`);
  if (boughtDc) console.log(`  ${pad("Bought w/ real money (PURCHASE)", 34)} ${String(boughtDc).padStart(10)} DC   [BDT, not CC]`);
  console.log(`  ${pad("Total DC acquired", 34)} ${String(r2(minedDc + wonDc + boughtDc)).padStart(10)} DC\n`);

  console.log(`── DC disposed ─────────────────────────────────────`);
  console.log(`  ${pad("Converted to CC (CONVERT/DC out)", 34)} ${String(convertedDcOut).padStart(10)} DC`);
  console.log(`  ${pad("Spent on games/packs (BURN/DC)", 34)} ${String(spentDc).padStart(10)} DC   [post-rework, DC-only]`);
  console.log(`  ${pad("Still held (play-only now)", 34)} ${String(r2(member.dcBalance)).padStart(10)} DC\n`);

  console.log(`── CC OUT breakdown (${burnCc.length} BURN/CC rows) ──────────────`);
  console.log(`  ${pad("game entry fees (→ minted DC)", 38)} ${String(-ccGame).padStart(10)} CC   (${count((t) => t.type === "BURN" && cur(t) === "CC" && from(t) && catOf(t) === "game")} rows)  COUNTS`);
  console.log(`  ${pad("mining packs, DC-era (→ minted DC)", 38)} ${String(-ccMiningDc).padStart(10)} CC   (${burnCc.filter((t) => catOf(t) === "mining" && !isLegacyMining(t)).length} rows)  COUNTS`);
  if (ccOther) console.log(`  ${pad("other CC burns", 38)} ${String(-ccOther).padStart(10)} CC   (${burnCc.filter((t) => catOf(t) === "other").length} rows)  COUNTS`);
  console.log(`  ${pad("mining packs, LEGACY (CC↔CC loop)", 38)} ${String(-ccMiningLegacy).padStart(10)} CC   (${burnCc.filter(isLegacyMining).length} rows)  EXCLUDED`);
  console.log("");

  console.log(`── CC profit/loss from the DC venture ──────────────`);
  console.log(`  CC IN  — DC→CC conversions:               ${money(ccInConvert).padStart(10)} CC   (${convRows.length} rows)`);
  for (const c of convRows) console.log(`      · ${pad(c.memo.slice(0, 52), 54)} +${c.amountCC} CC`);
  console.log(`  CC OUT — CC that bought into DC:           ${money(-ccOutDc).padStart(10)} CC   (game + DC-era packs)`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  NET CC from DC:                           ${money(netCc).padStart(10)} CC   => ${netCc > 0 ? "PROFIT" : netCc < 0 ? "LOSS" : "BREAK-EVEN"}`);
  console.log("");
  console.log(`  For reference:`);
  console.log(`    · if mining CC is excluded entirely (games only):  ${money(netGamesOnly)} CC`);
  console.log(`    · legacy CC-mining loop (excluded above): spent ${ccMiningLegacy} CC on packs, earned ${legacyMineReward} CC in MINE/CC rewards`);
  if (r2(member.dcBalance) > 0)
    console.log(`    · ${r2(member.dcBalance)} DC still held can no longer convert — locked to play, outside this CC P&L.`);
  console.log("");
})().catch((e) => { console.error("ERR:", (e && e.stack) || e); process.exit(1); });
