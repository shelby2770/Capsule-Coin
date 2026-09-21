#!/usr/bin/env node
/*
 * Top up DC for a day's tier-2/tier-3 Guess-the-Word rewards after a reward-
 * MULTIPLIER change: re-rate each qualifying play from the OLD tier multiplier to
 * the NEW one and credit the player the difference as fresh GAME/DC (reserve-
 * capped). Use when you raise config.games.word.tierRewardMult and want players
 * who already played that tier that day to receive the higher rate retroactively.
 *
 *   node scripts/sync-word-tier-rewards.cjs                 # dry run (default; yesterday UTC)
 *   node scripts/sync-word-tier-rewards.cjs --commit        # apply (backs up first)
 *   node scripts/sync-word-tier-rewards.cjs --day 2026-09-20 --commit
 *   node scripts/sync-word-tier-rewards.cjs --doc capsule_test   # test namespace
 *
 * Flags:
 *   --commit       write to Firestore (default is a dry run that writes nothing)
 *   --day <UTC>    UTC calendar day of the plays to sync (YYYY-MM-DD; default = yesterday UTC)
 *   --doc <id>     ledger doc id (default "state"; e.g. "capsule_test")
 *   --old-t2 / --new-t2 / --old-t3 / --new-t3   from/to multipliers (defaults 1.2/1.4 and 1.3/1.5)
 *   --supply-cap <n>   DC reserve cap (default 5000; matches config.mining.supplyCap)
 *   --force        apply again even if this day already has sync rows (WILL double up)
 *
 * How the top-up is computed:
 *   A stored word reward = base(attempts) × timeFactor × oldMult. Re-rating to the
 *   new multiplier means multiplying by newMult/oldMult, so the extra DP owed for a
 *   session is  reward × (newMult/oldMult − 1)  — exactly what that same play would
 *   have earned under the new multiplier, minus what it already paid. Only positive
 *   top-ups are applied. Source of truth for (member, tier, reward) is the word
 *   SESSION doc (session.totalReward = DC actually minted for that session); the
 *   credit is applied to the ledger as one GAME/DC row per play.
 *
 * Reserve: new DC is minted against the shared reserve (supplyCap − net mined DC,
 *   where GAME counts as mined and CONVERT reopens headroom — mirrors store.ts). If
 *   the batch would exceed the remaining reserve it is scaled down to fit, with a
 *   loud warning. Idempotent: refuses to apply a day twice unless --force.
 *
 * Hash chain matches store.appendTransaction: payload =
 *   [seq,type,fromEmail,toEmail,amountCC,offerId,createdAt,memo] joined by "|";
 *   hash = sha256(prevHash + "|" + payload). Rows are appended, so existing hashes
 *   are untouched; the whole chain is re-verified before exit.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");

const ROOT = path.join(__dirname, "..");
const svc = require(path.join(ROOT, "capsule-coin-firebase-adminsdk-fbsvc-fea87c9661.json"));
admin.initializeApp({ credential: admin.credential.cert(svc), projectId: "capsule-coin" });
const db = admin.firestore();

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const numOpt = (n, d) => { const v = opt(n); const x = v === undefined ? d : Number(v); return Number.isFinite(x) ? x : d; };
const DOC = opt("doc") || process.env.LEDGER_DOC_ID || "state";
const COMMIT = flag("commit");
const FORCE = flag("force");
const DAY = opt("day") || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10); // yesterday UTC
const SESSIONS_COL = (DOC === "state" ? "" : `${DOC}__`) + "gameSessions"; // same namespacing as lib/games/common
const SUPPLY_CAP = numOpt("supply-cap", 5000);
const MULT = {
  2: { old: numOpt("old-t2", 1.2), new: numOpt("new-t2", 1.4) },
  3: { old: numOpt("old-t3", 1.3), new: numOpt("new-t3", 1.5) },
};
const TAG = `word-sync ${DAY}`; // idempotency marker embedded in each memo
const r2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;
const dayOfMs = (ms) => new Date(Number(ms)).toISOString().slice(0, 10);

/** reserveRemaining, mirrored from lib/excel/store.ts (GAME mints, CONVERT reopens). */
function reserveRemaining(txs) {
  let mined = 0, converted = 0;
  for (const t of txs) {
    if (t.currency !== "DC") continue;
    if (t.type === "MINE" || t.type === "GAME") mined += Number(t.amountCC || 0);
    else if (t.type === "CONVERT") converted += Number(t.amountCC || 0);
  }
  return r2(SUPPLY_CAP - Math.max(0, mined - converted));
}

(async () => {
  // 1) the day's tier-2/3 word sessions (source of truth for tier + minted reward)
  const qs = await db.collection(SESSIONS_COL).where("kind", "==", "word").get();
  const sessions = qs.docs
    .map((d) => d.data())
    .filter((s) => (s.tier === 2 || s.tier === 3) && dayOfMs(s.createdAt) === DAY)
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));

  console.log(`sessions: ${SESSIONS_COL}  | ledger: ${DOC}  | target UTC day: ${DAY}`);
  console.log(`Re-rate:  tier 2 ×${MULT[2].old} -> ×${MULT[2].new}   |   tier 3 ×${MULT[3].old} -> ×${MULT[3].new}`);
  console.log(`Mode: ${COMMIT ? "COMMIT" : "DRY RUN (no writes)"}\n`);

  // 2) per-session top-up = reward × (newMult/oldMult − 1)
  const items = [];
  for (const s of sessions) {
    const m = MULT[s.tier];
    const reward = r2(s.totalReward);
    const delta = r2(reward * (m.new / m.old - 1));
    if (reward <= 0 || delta <= 0) continue;
    items.push({ email: String(s.email || "").toLowerCase(), tier: s.tier, reward, delta, status: s.status, createdAt: new Date(Number(s.createdAt)).toISOString() });
  }

  console.log(`Qualifying tier-2/3 word plays on ${DAY}: ${items.length}`);
  for (const it of items) {
    console.log(`  ${String(it.email).padEnd(32)} tier ${it.tier}  ${String(it.status).padEnd(9)} won ${String(it.reward).padStart(8)} DC  ->  +${String(it.delta).padStart(7)} DC   ${it.createdAt}`);
  }
  const perMember = {};
  for (const it of items) perMember[it.email] = r2((perMember[it.email] || 0) + it.delta);
  const totalDelta = r2(items.reduce((a, b) => a + b.delta, 0));
  console.log(`\nPer-member top-up:`);
  for (const [email, d] of Object.entries(perMember)) console.log(`  ${String(email).padEnd(32)} +${d} DC`);
  console.log(`Total top-up: ${totalDelta} DC across ${Object.keys(perMember).length} member(s)\n`);

  if (items.length === 0) { console.log("Nothing to top up. Exiting."); process.exit(0); }

  // 3) load ledger; idempotency + reserve
  const ref = db.collection("ledger").doc(DOC);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`No ledger/${DOC}`);
  const rawLive = snap.data().json;
  const state = JSON.parse(rawLive);
  const txs = [...(state.transactions || [])].sort((a, b) => a.seq - b.seq);

  const already = txs.some((t) => String(t.memo || "").includes(TAG));
  if (already && !FORCE) {
    console.log(`REFUSING: ledger already has "${TAG}" rows — this day looks synced. Re-run with --force to apply again.`);
    process.exit(1);
  }
  if (already && FORCE) console.log(`! "${TAG}" already present — --force given, applying AGAIN (this WILL double up).\n`);

  const reserve = reserveRemaining(txs);
  let scale = 1;
  console.log(`Reserve remaining: ${reserve} DC (supplyCap ${SUPPLY_CAP})`);
  if (totalDelta > reserve) {
    scale = reserve > 0 ? reserve / totalDelta : 0;
    console.log(`! WARNING: top-up ${totalDelta} DC exceeds reserve ${reserve} DC — scaling every top-up by ${scale.toFixed(4)} to fit the cap.`);
  }
  console.log("");

  if (!COMMIT) {
    console.log("DRY RUN — nothing written. Re-run with --commit to apply.");
    process.exit(0);
  }

  // 4) append one GAME/DC row per play (reserve-scaled) + credit dcBalance
  const byEmail = new Map((state.members || []).map((m) => [m.email, m]));
  let prevHash = txs.length ? txs[txs.length - 1].hash : "GENESIS";
  let seq = txs.length ? txs[txs.length - 1].seq : 0;
  const now = Date.now();
  let i = 0, mintedTotal = 0, applied = 0;
  for (const it of items) {
    const m = byEmail.get(it.email);
    if (!m) { console.log(`  ! ${it.email} isn't a current member — skipping +${it.delta} DC`); continue; }
    const amt = r2(it.delta * scale);
    if (amt <= 0) continue;
    seq += 1;
    const createdAt = new Date(now + i++).toISOString();
    const memo = `Sync top-up (${TAG}): tier ${it.tier} word reward re-rated ×${MULT[it.tier].old}->×${MULT[it.tier].new}`;
    const payload = [seq, "GAME", "", it.email, amt, "", createdAt, memo].join("|");
    const hash = crypto.createHash("sha256").update(`${prevHash}|${payload}`).digest("hex");
    txs.push({
      seq, id: crypto.randomUUID(), type: "GAME", currency: "DC",
      fromEmail: null, toEmail: it.email, amountCC: amt, offerId: null,
      memo, createdAt, prevHash, hash, externalId: null,
    });
    prevHash = hash;
    m.dcBalance = r2((m.dcBalance || 0) + amt);
    mintedTotal = r2(mintedTotal + amt);
    applied += 1;
  }

  // 5) backup + write
  const backupPath = path.join(ROOT, "data", `prod-backup-wordsync-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, rawLive);
  console.log(`backup written: ${backupPath}`);
  const next = { ...state, transactions: txs };
  await ref.set({ json: JSON.stringify(next), updatedAt: new Date().toISOString() });
  console.log(`written to ledger/${DOC}: +${applied} GAME row(s), ${mintedTotal} DC minted.`);

  // 6) verify chain + seq + reserve
  const after = JSON.parse((await ref.get()).data().json).transactions;
  let prev = "GENESIS", chainOk = true;
  for (const t of after) {
    const p = [t.seq, t.type, t.fromEmail ?? "", t.toEmail ?? "", t.amountCC, t.offerId ?? "", t.createdAt, t.memo].join("|");
    const h = crypto.createHash("sha256").update(`${prev}|${p}`).digest("hex");
    if (h !== t.hash || t.prevHash !== prev) { chainOk = false; break; }
    prev = t.hash;
  }
  const seqOk = after.every((t, idx) => t.seq === idx + 1);
  const reserveAfter = reserveRemaining(after);
  console.log(`verify: txs=${after.length}; chain valid=${chainOk}; seq contiguous=${seqOk}; reserve now ${reserveAfter} DC (>=0: ${reserveAfter >= 0})`);
  process.exit(chainOk && seqOk && reserveAfter >= 0 ? 0 : 1);
})().catch((e) => { console.error("ERR:", (e && e.stack) || e); process.exit(1); });
