#!/usr/bin/env node
/*
 * Reset ONE day of Guess-the-Word activity: remove that day's word-game ledger
 * rows (and, by default, that day's DC<->CC conversions), reverse their balance
 * effects, re-sequence + re-hash the chain, and give every member a fresh daily
 * free play. Use after changing the word-reward curve to wipe the day's plays so
 * everyone can replay under the new rules.
 *
 *   node scripts/reset-word-game-day.cjs                       # dry run (default)
 *   node scripts/reset-word-game-day.cjs --commit              # apply (backs up first)
 *   node scripts/reset-word-game-day.cjs --day 2026-09-20      # a specific UTC day
 *   node scripts/reset-word-game-day.cjs --doc capsule_test --commit   # test namespace
 *
 * Flags:
 *   --commit        write to Firestore (default is a dry run that writes nothing)
 *   --day <UTC>     UTC calendar day to target (YYYY-MM-DD; default = today UTC)
 *   --doc <id>      ledger doc id (default "state"; e.g. "capsule_test")
 *   --no-convert    do NOT remove/reverse that day's DC<->CC conversions
 *   --no-free       do NOT reset members' daily free play
 *
 * What's removed (by createdAt on the target UTC day):
 *   - word entry fees   BURN rows whose memo contains "word game"  -> refund CC
 *   - word rewards      GAME rows whose memo contains "word game"  -> claw back DC (clamp >=0)
 *   - conversions       CONVERT rows (both legs)                    -> reverse CC + DC legs
 * Balances: a settled row did `from -= amt; to += amt` on its currency; removing
 * it reverses that (`from += amt; to -= amt`), so each member's stored balance
 * still equals the sum of their remaining rows. Free play: freeMinesUsed -> 0.
 *
 * Hash chain matches store.appendTransaction: payload =
 *   [seq,type,fromEmail,toEmail,amountCC,offerId,createdAt,memo] joined by "|";
 *   hash = sha256(prevHash + "|" + payload). Rows after the earliest removal are
 *   re-hashed; the whole rebuilt chain is verified before write.
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
const DOC = opt("doc") || process.env.LEDGER_DOC_ID || "state";
const COMMIT = flag("commit");
const NO_CONVERT = flag("no-convert");
const NO_FREE = flag("no-free");
const DAY = opt("day") || new Date().toISOString().slice(0, 10); // UTC calendar day
const r2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;
const dayOf = (iso) => new Date(Date.parse(iso)).toISOString().slice(0, 10); // UTC day of a tx
const isWord = (t) => String(t.memo || "").toLowerCase().includes("word game");

/** Recompute a clean hash chain over ordered source txs (matches store.appendTransaction). */
function rechain(src) {
  let prevHash = "GENESIS";
  return src.map((t, i) => {
    const seq = i + 1;
    const payload = [seq, t.type, t.fromEmail ?? "", t.toEmail ?? "", t.amountCC, t.offerId ?? "", t.createdAt, t.memo].join("|");
    const hash = crypto.createHash("sha256").update(`${prevHash}|${payload}`).digest("hex");
    const out = {
      seq, id: t.id, type: t.type, currency: t.currency ?? "CC",
      fromEmail: t.fromEmail ?? null, toEmail: t.toEmail ?? null,
      amountCC: t.amountCC, offerId: t.offerId ?? null, memo: t.memo,
      createdAt: t.createdAt, prevHash, hash, externalId: t.externalId ?? null,
    };
    prevHash = hash;
    return out;
  });
}

(async () => {
  const ref = db.collection("ledger").doc(DOC);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`No ledger/${DOC}`);
  const rawLive = snap.data().json;
  const state = JSON.parse(rawLive);
  const sorted = [...(state.transactions || [])].sort((a, b) => a.seq - b.seq);

  console.log(`ledger/${DOC}: ${sorted.length} txns, ${state.members?.length || 0} members`);
  console.log(`Target UTC day: ${DAY}  | conversions: ${NO_CONVERT ? "kept" : "reversed"} | free play: ${NO_FREE ? "unchanged" : "reset for ALL"}`);
  console.log(`Mode: ${COMMIT ? "COMMIT" : "DRY RUN (no writes)"}\n`);

  const onDay = (t) => dayOf(t.createdAt) === DAY;
  const wordBurns = sorted.filter((t) => onDay(t) && t.type === "BURN" && isWord(t));
  const wordGames = sorted.filter((t) => onDay(t) && t.type === "GAME" && isWord(t));
  const converts = NO_CONVERT ? [] : sorted.filter((t) => onDay(t) && t.type === "CONVERT");
  const targetSet = new Set([...wordBurns, ...wordGames, ...converts]);
  const targets = sorted.filter((t) => targetSet.has(t));

  const listRows = (label, arr) => {
    console.log(`${label}: ${arr.length}`);
    for (const t of arr) {
      const who = t.toEmail || t.fromEmail || "-";
      console.log(`  seq ${String(t.seq).padStart(5)} ${t.type}/${t.currency || "CC"} ${String(who).padEnd(32)} ${String(t.amountCC).padStart(8)}  ${t.createdAt}  "${String(t.memo).slice(0, 52)}"`);
    }
  };
  listRows("Word entry fees (BURN, refund CC)", wordBurns);
  listRows("Word rewards (GAME, claw back DC)", wordGames);
  if (!NO_CONVERT) listRows("Conversions (CONVERT, reverse both legs)", converts);
  console.log("");

  if (targets.length === 0 && NO_FREE) {
    console.log("Nothing to do. Exiting.");
    process.exit(0);
  }

  // Balance reversal: from += amt, to -= amt on the row's currency field.
  const byEmail = new Map((state.members || []).map((m) => [m.email, m]));
  const delta = new Map(); // email -> { cc, dc }
  const bump = (email, key, v) => {
    if (!email) return;
    const d = delta.get(email) || { cc: 0, dc: 0 };
    d[key] = r2(d[key] + v);
    delta.set(email, d);
  };
  for (const t of targets) {
    const amt = Number(t.amountCC || 0);
    const key = (t.currency || "CC") === "DC" ? "dc" : "cc";
    bump(t.fromEmail, key, +amt); // reverse the debit
    bump(t.toEmail, key, -amt); // reverse the credit
  }

  console.log(`Balance reversals: ${delta.size} member(s)`);
  const warnings = [];
  for (const [email, d] of delta) {
    const m = byEmail.get(email);
    if (!m) { console.log(`  ! ${email} isn't a current member — skipping`); continue; }
    const ccAfter = r2(m.balance + d.cc);
    const dcRaw = r2(m.dcBalance + d.dc);
    const dcAfter = Math.max(0, dcRaw);
    console.log(`  ${String(m.name || email).padEnd(26)} CC ${r2(m.balance)} -> ${ccAfter} (${d.cc >= 0 ? "+" : ""}${d.cc}) | DC ${r2(m.dcBalance)} -> ${dcAfter} (${d.dc >= 0 ? "+" : ""}${d.dc})`);
    if (dcRaw < 0) warnings.push(`${m.name || email}: DC would be ${dcRaw}, clamped to 0 (spent more than clawed back).`);
    if (ccAfter < 0) warnings.push(`${m.name || email}: CC goes negative (${ccAfter}).`);
  }
  if (warnings.length) { console.log("\nWARNINGS:"); warnings.forEach((w) => console.log(`  ! ${w}`)); }
  console.log("");

  const freeToReset = NO_FREE ? [] : (state.members || []).filter((m) => (m.freeMinesUsed || 0) !== 0);
  console.log(`Free-play reset: ${NO_FREE ? "SKIPPED" : `freeMinesUsed -> 0 for ${freeToReset.length} member(s) currently >0 (all members set to 0)`}`);

  const remaining = sorted.filter((t) => !targetSet.has(t));
  const rebuilt = rechain(remaining);
  console.log(`Transactions: ${sorted.length} -> ${rebuilt.length} (removed ${targets.length})\n`);

  if (!COMMIT) {
    console.log("DRY RUN — nothing written. Re-run with --commit to apply.");
    process.exit(0);
  }

  // Apply balances
  for (const [email, d] of delta) {
    const m = byEmail.get(email);
    if (!m) continue;
    m.balance = r2(m.balance + d.cc);
    m.dcBalance = Math.max(0, r2(m.dcBalance + d.dc));
  }
  // Reset free play for everyone
  if (!NO_FREE) for (const m of state.members || []) m.freeMinesUsed = 0;

  const next = { ...state, transactions: rebuilt };
  const backupPath = path.join(ROOT, "data", `prod-backup-wordreset-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, rawLive);
  console.log(`backup written: ${backupPath}`);
  await ref.set({ json: JSON.stringify(next), updatedAt: new Date().toISOString() });
  console.log(`written to ledger/${DOC}.`);

  // Verify chain + seq
  const after = JSON.parse((await ref.get()).data().json).transactions;
  let prev = "GENESIS", chainOk = true;
  for (const t of after) {
    const payload = [t.seq, t.type, t.fromEmail ?? "", t.toEmail ?? "", t.amountCC, t.offerId ?? "", t.createdAt, t.memo].join("|");
    const h = crypto.createHash("sha256").update(`${prev}|${payload}`).digest("hex");
    if (h !== t.hash || t.prevHash !== prev) { chainOk = false; break; }
    prev = t.hash;
  }
  const seqOk = after.every((t, i) => t.seq === i + 1);
  const noneLeft = !after.some((t) => targetSet.has(t) || (dayOf(t.createdAt) === DAY && ((t.type === "GAME" && isWord(t)) || (t.type === "BURN" && isWord(t)))));
  console.log(`verify: txs=${after.length} (expect ${rebuilt.length}); chain valid=${chainOk}; seq contiguous=${seqOk}; word rows gone=${noneLeft}`);
  process.exit(chainOk && seqOk ? 0 : 1);
})().catch((e) => { console.error("ERR:", (e && e.stack) || e); process.exit(1); });
