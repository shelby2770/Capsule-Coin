#!/usr/bin/env node
/*
 * Delete ONE ledger transaction by --seq or --hash, then re-sequence and
 * re-hash the chain so it stays valid, and (by default) reverse the deleted
 * transaction's balance effect so stored balances stay consistent with history.
 *
 *   node scripts/delete-transaction.cjs --seq 614                 # dry run (default)
 *   node scripts/delete-transaction.cjs --seq 614 --commit        # apply (backs up first)
 *   node scripts/delete-transaction.cjs --hash 6b19... --commit
 *   node scripts/delete-transaction.cjs --seq 614 --hash 6b19...  # both must match the same row
 *
 * Flags:
 *   --seq <n> | --hash <hex>   identify the transaction (at least one; if both, they must match)
 *   --commit                   write to Firestore (default is a dry run that writes nothing)
 *   --doc <id>                 ledger doc id (default "state"; e.g. "capsule_test")
 *   --no-balance               delete + re-sequence only; do NOT reverse the balance effect
 *   --force                    allow deleting side-effect/paired types (CONVERT, PURCHASE, ESCROW_*)
 *
 * Balances (default): a settled tx did `from -= amt; to += amt` on its currency
 * (CC -> balance, DC -> dcBalance). Deleting it reverses that: `from += amt;
 * to -= amt`, so each member's stored balance still equals the sum of their
 * remaining transactions.
 *
 * Hash chain: payload = [seq,type,fromEmail,toEmail,amountCC,offerId,createdAt,memo]
 * joined by "|"; hash = sha256(prevHash + "|" + payload). Since seq is in the
 * payload, every row AFTER the deleted one is re-hashed; rows BEFORE it are
 * unchanged (same seq -> same hash), which the script verifies.
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
const SEQ = opt("seq") != null ? Number(opt("seq")) : null;
const HASH = opt("hash") ? String(opt("hash")).trim().toLowerCase() : null;
const DOC = opt("doc") || process.env.LEDGER_DOC_ID || "state";
const COMMIT = flag("commit");
const NO_BALANCE = flag("no-balance");
const FORCE = flag("force");
const r2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;

if (SEQ == null && !HASH) {
  console.error("Specify --seq <n> or --hash <hex> (at least one).");
  process.exit(2);
}

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

const RISKY = new Set(["CONVERT", "PURCHASE", "ESCROW_LOCK", "ESCROW_REFUND"]);

(async () => {
  const ref = db.collection("ledger").doc(DOC);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`No ledger/${DOC}`);
  const rawLive = snap.data().json;
  const state = JSON.parse(rawLive);
  const sorted = [...(state.transactions || [])].sort((a, b) => a.seq - b.seq);

  // locate the target (unique)
  const matchSeq = (t) => SEQ == null || t.seq === SEQ;
  const matchHash = (t) => !HASH || (t.hash || "").toLowerCase() === HASH;
  const matches = sorted.filter((t) => matchSeq(t) && matchHash(t));
  if (matches.length !== 1) {
    console.error(`Expected exactly 1 matching tx, found ${matches.length} for ${SEQ != null ? `seq=${SEQ} ` : ""}${HASH ? `hash=${HASH}` : ""}.`);
    process.exit(1);
  }
  const target = matches[0];
  const idx = sorted.indexOf(target);

  console.log("Target tx:");
  console.log(`  seq=${target.seq} type=${target.type} currency=${target.currency || "CC"}`);
  console.log(`  from=${target.fromEmail || "-"} to=${target.toEmail || "-"} amount=${target.amountCC}`);
  console.log(`  memo="${target.memo}"  createdAt=${target.createdAt}`);
  console.log(`  hash=${target.hash}`);
  console.log("");

  if (RISKY.has(target.type) && !NO_BALANCE && !FORCE) {
    console.error(
      `x ${target.type} has side effects this tool won't auto-handle:` +
      (target.type === "CONVERT" ? "\n  - CONVERT is TWO rows (a DC leg + a CC leg); deleting one alone corrupts the pair." : "") +
      (target.type === "PURCHASE" ? "\n  - PURCHASE also added BDT to the Fruit Fund (not stored on the tx)." : "") +
      (target.type.startsWith("ESCROW") ? "\n  - ESCROW rows are tied to an offer's escrow state." : "") +
      `\n  Re-run with --force to reverse just the CC/DC balance leg anyway, or --no-balance to only delete+re-sequence.`,
    );
    process.exit(1);
  }

  // balance reversal plan
  const byEmail = new Map((state.members || []).map((m) => [m.email, m]));
  const field = target.currency === "DC" ? "dcBalance" : "balance";
  const amt = Number(target.amountCC || 0);
  const changes = [];
  if (!NO_BALANCE) {
    if (target.fromEmail) {
      const m = byEmail.get(target.fromEmail);
      if (!m) console.log(`  ! from ${target.fromEmail} isn't a current member — skipping its balance reversal`);
      else changes.push({ m, before: r2(m[field]), after: r2(m[field] + amt), who: m.name || m.email, dir: `+${amt}` });
    }
    if (target.toEmail) {
      const m = byEmail.get(target.toEmail);
      if (!m) console.log(`  ! to ${target.toEmail} isn't a current member — skipping its balance reversal`);
      else changes.push({ m, before: r2(m[field]), after: r2(m[field] - amt), who: m.name || m.email, dir: `-${amt}` });
    }
  }

  const remaining = sorted.filter((t) => t !== target);
  const rebuilt = rechain(remaining);

  console.log(`Transactions: ${sorted.length} -> ${rebuilt.length} (removed seq ${target.seq})`);
  const shifted = sorted.length - 1 - idx;
  console.log(`Re-sequenced ${shifted} row(s) after it (each seq -1) and re-hashed the chain from there.`);
  console.log("");
  if (NO_BALANCE) console.log("Balance reversal: SKIPPED (--no-balance).");
  else if (changes.length === 0) console.log("Balance reversal: nothing to reverse.");
  else {
    console.log(`Balance reversal (${field}):`);
    for (const c of changes) console.log(`  ${String(c.who).padEnd(28)} ${c.before} -> ${c.after} (${c.dir})`);
  }
  for (const c of changes) {
    if (field === "dcBalance" && c.after < 0) console.log(`  ! ${c.who}'s DC would go negative (${c.after}); it will be clamped to 0.`);
  }
  console.log("");

  // SAFETY: rows before the deleted one must be byte-identical after re-chain.
  const prefixOk = rebuilt.slice(0, idx).every((t, i) => t.hash === sorted[i].hash && t.seq === sorted[i].seq);
  if (!prefixOk) { console.error("x SAFETY: re-chain altered a row BEFORE the deleted seq — aborting."); process.exit(1); }
  console.log(`ok rows before seq ${target.seq} are byte-identical after re-chain`);

  if (!COMMIT) {
    console.log("\nDRY RUN — nothing written. Re-run with --commit to apply.");
    process.exit(0);
  }

  for (const c of changes) c.m[field] = field === "dcBalance" ? Math.max(0, c.after) : c.after;
  const next = { ...state, transactions: rebuilt };

  const backupPath = path.join(ROOT, "data", `prod-backup-deletetx-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, rawLive);
  console.log(`\nbackup written: ${backupPath}`);
  await ref.set({ json: JSON.stringify(next), updatedAt: new Date().toISOString() });
  console.log(`written to ledger/${DOC}.`);

  // verify
  const after = JSON.parse((await ref.get()).data().json).transactions;
  const gone = !after.some((t) => (t.hash || "").toLowerCase() === (target.hash || "").toLowerCase());
  let prev = "GENESIS", chainOk = true;
  for (const t of after) {
    const payload = [t.seq, t.type, t.fromEmail ?? "", t.toEmail ?? "", t.amountCC, t.offerId ?? "", t.createdAt, t.memo].join("|");
    const h = crypto.createHash("sha256").update(`${prev}|${payload}`).digest("hex");
    if (h !== t.hash || t.prevHash !== prev) { chainOk = false; break; }
    prev = t.hash;
  }
  const seqOk = after.every((t, i) => t.seq === i + 1);
  console.log(`verify: txs=${after.length} (expect ${rebuilt.length}); target gone=${gone}; chain valid=${chainOk}; seq contiguous=${seqOk}`);
  process.exit(gone && chainOk && seqOk ? 0 : 1);
})().catch((e) => { console.error("ERR:", (e && e.stack) || e); process.exit(1); });
