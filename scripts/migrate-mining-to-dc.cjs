#!/usr/bin/env node
/**
 * One-time migration: turn all historical MINING into Dark Capsule Coin (DC).
 *
 *   node scripts/migrate-mining-to-dc.cjs [--dry] [--force]
 *
 * For every member:
 *   - DC start balance = the sum of all CC that mining ever paid them (their MINE rows).
 *   - Their CC is reduced by that amount, but never below the soft floor (BALANCE_FLOOR,
 *     default -500) — any shortfall is FORGIVEN (so nobody is pushed into grace by the
 *     migration itself). Each CC deduction is recorded as an ADJUST transaction.
 *   - Every historical MINE row is re-labelled currency = "DC" (hash unaffected — currency
 *     is not part of the hash payload), so it moves to the Mining tab and counts against
 *     the DC supply cap.
 *
 * A full backup of the live ledger JSON is written to data/ before anything changes.
 * --dry  = read + report only, write NOTHING (safe preview).
 * --force = run even if it looks already migrated (DANGER: re-applies; use only on a
 *           freshly restored backup).
 *
 * Run coordinated with a deploy: after this, set DC_REF_SUPPLY to the printed total and
 * re-sync the Google Sheet (POST /api/sheets/sync, or it syncs on the next app write).
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const admin = require("firebase-admin");
const svc = require(path.join(__dirname, "..", "capsule-coin-firebase-adminsdk-fbsvc-fea87c9661.json"));
admin.initializeApp({ credential: admin.credential.cert(svc), projectId: "capsule-coin" });
const db = admin.firestore();

const LEDGER_DOC = process.env.LEDGER_DOC_ID || "state";
const SOFT_FLOOR = Number(process.env.BALANCE_FLOOR || -500);
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const DRY = process.argv.includes("--dry") || process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

/** Append a hash-chained transaction, matching lib/excel/store.ts appendTransaction. */
function appendTx(state, data) {
  const txs = state.transactions;
  const seq = txs.length + 1;
  const prevHash = txs.length ? txs[txs.length - 1].hash : "GENESIS";
  const createdAt = new Date().toISOString();
  const payload = [seq, data.type, data.fromEmail ?? "", data.toEmail ?? "", data.amountCC, data.offerId ?? "", createdAt, data.memo].join("|");
  const hash = crypto.createHash("sha256").update(prevHash + "|" + payload).digest("hex");
  txs.push({ seq, id: crypto.randomUUID(), ...data, createdAt, prevHash, hash, externalId: null });
}

(async () => {
  const ref = db.collection("ledger").doc(LEDGER_DOC);
  const snap = await ref.get();
  if (!snap.exists) { console.error("No ledger doc found at ledger/" + LEDGER_DOC); process.exit(1); }
  const rawJson = snap.data().json;
  const state = JSON.parse(rawJson);
  state.members = state.members || [];
  state.transactions = state.transactions || [];

  const alreadyDc = state.transactions.some((t) => t.type === "MINE" && t.currency === "DC");
  if (alreadyDc && !FORCE) {
    console.error("✗ Looks already migrated (some MINE rows are already DC). Use --force only on a fresh restore.");
    process.exit(1);
  }

  // Backup the live JSON before touching anything.
  const backupPath = path.join(__dirname, "..", "data", `prod-backup-migrate-dc-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, rawJson);
  console.log("Backup written: " + backupPath + "\n");

  // Sum each member's lifetime mined CC.
  const minedByEmail = new Map();
  for (const t of state.transactions) {
    if (t.type === "MINE" && t.toEmail) {
      minedByEmail.set(t.toEmail, round2((minedByEmail.get(t.toEmail) || 0) + Number(t.amountCC || 0)));
    }
  }

  // Apply per member.
  const report = [];
  let totalDc = 0, totalForgiven = 0;
  for (const m of state.members) {
    if (typeof m.dcBalance !== "number") m.dcBalance = 0;
    if (m.graceUntil === undefined) m.graceUntil = null;
    if (typeof m.banned !== "boolean") m.banned = false;
    if (m.onboardedAt === undefined) m.onboardedAt = null;

    const mined = round2(minedByEmail.get(m.email) || 0);
    if (mined > 0) {
      const oldCc = round2(m.balance || 0);
      const newCc = Math.max(round2(oldCc - mined), SOFT_FLOOR);
      const deducted = round2(oldCc - newCc);
      const forgiven = round2(mined - deducted);
      m.dcBalance = round2(m.dcBalance + mined);
      m.balance = newCc;
      totalForgiven = round2(totalForgiven + forgiven);
      report.push({ name: m.name || m.email, mined, oldCc, newCc, deducted, forgiven });
      if (deducted > 0) {
        appendTx(state, {
          type: "ADJUST", currency: "CC", fromEmail: m.email, toEmail: null,
          amountCC: deducted, offerId: null,
          memo: `DC migration: ${mined} mined CC moved to DC` + (forgiven > 0 ? ` (deducted ${deducted}, ${forgiven} forgiven at ${SOFT_FLOOR} floor)` : ""),
        });
      }
    }
    totalDc = round2(totalDc + round2(m.dcBalance || 0));
  }

  // Re-label historical MINE rows as DC; default any missing currency to CC.
  let relabeled = 0;
  for (const t of state.transactions) {
    if (t.type === "MINE" && t.currency !== "DC") { t.currency = "DC"; relabeled++; }
    else if (t.currency === undefined) t.currency = "CC";
  }
  if (typeof state.fruitFundBdt !== "number") state.fruitFundBdt = 0;

  // Report.
  console.log("Per-member migration:");
  console.log("  " + ["Member", "mined→DC", "old CC", "new CC", "deducted", "forgiven"].join("\t"));
  for (const r of report) {
    console.log("  " + [r.name, r.mined, r.oldCc, r.newCc, r.deducted, r.forgiven].join("\t"));
  }
  console.log("\nMINE rows re-labelled to DC: " + relabeled);
  console.log("Total DC in circulation after migration: " + round2(totalDc));
  console.log("Total CC forgiven at the floor: " + totalForgiven);
  console.log("\n>>> Set  DC_REF_SUPPLY=" + Math.max(1, Math.round(totalDc)) + "  (the conversion anchor S0) so your 2/10/20 rates hold at launch.");

  if (DRY) {
    console.log("\nDRY RUN — nothing written to Firestore.");
    process.exit(0);
  }

  await ref.set({ json: JSON.stringify(state), updatedAt: new Date().toISOString() });
  console.log("\n✅ Migration written to Firestore (ledger/" + LEDGER_DOC + ").");
  console.log("   Next: re-sync the sheet (POST /api/sheets/sync with SEED_TOKEN, or it syncs on the next app write).");
  process.exit(0);
})().catch((e) => { console.error("ERR:", e && e.message ? e.message : e); process.exit(1); });
