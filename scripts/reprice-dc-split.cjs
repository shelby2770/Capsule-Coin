#!/usr/bin/env node
/*
 * One-off: RE-PRICE a member's one-time DC->CC split migration to a flat per-DC rate,
 * and drop any 1:1 correction rows previously added by fix-dc-split-1to1.cjs. Unlike
 * that append-only tool, this EDITS the migration rows in place, so it re-sequences
 * and re-hashes the chain (same approach as delete-transaction.cjs) and reverses the
 * net balance effect. CC-side only, so the DC reserve (counts only DC) is untouched.
 *
 *   node scripts/reprice-dc-split.cjs --name Shafi --rate 0.8            # dry run (default)
 *   node scripts/reprice-dc-split.cjs --email shafi.kader@x.com --rate 0.8 --commit
 *   node scripts/reprice-dc-split.cjs --name Shafi --rate 0.8 --doc capsule_test
 *
 * Flags:
 *   --rate <n>      new flat CC-per-DC rate for the migration (REQUIRED; e.g. 0.8)
 *   --email <addr>  target member by exact email
 *   --name <text>   target member whose name contains this text (case-insensitive)
 *   --commit        write to Firestore (default is a dry run that writes nothing)
 *   --doc <id>      ledger doc id (default "state"; e.g. "capsule_test")
 *   --keep-corrections   reprice only; do NOT remove the dc-split-1to1 correction rows
 *
 * What it changes for the target member:
 *   - CONVERT/CC (the "+X CC from the one-time DC split migration" leg): amountCC ->
 *     dcConverted*rate, memo updated.
 *   - CONVERT/DC (the "Split migration: converted …" leg): memo updated to the new
 *     rate. Its DC amount is unchanged (all their DC still left circulation).
 *   - removes ADJUST/CC rows whose memo carries "dc-split-1to1 <email>" (the reverts).
 *   - member.balance += (newCC - oldCC) - (sum of removed correction credits).
 *
 * Hash chain: payload = [seq,type,fromEmail,toEmail,amountCC,offerId,createdAt,memo]
 * joined by "|"; hash = sha256(prevHash + "|" + payload). Every row from the first
 * change onward is re-hashed; rows before it must stay byte-identical (verified).
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
const KEEP_CORRECTIONS = flag("keep-corrections");
const EMAIL = (opt("email") || "").trim().toLowerCase();
const NAME = (opt("name") || "").trim().toLowerCase();
const RATE = opt("rate") != null ? Number(opt("rate")) : null;
const r2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;

if (!EMAIL && !NAME) { console.error("Pick the member: --email <addr> or --name <text>."); process.exit(2); }
if (!(Number.isFinite(RATE) && RATE > 0)) { console.error("Provide a positive --rate <n> (e.g. 0.8)."); process.exit(2); }

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
  const members = state.members || [];
  const sorted = [...(state.transactions || [])].sort((a, b) => a.seq - b.seq);

  console.log(`ledger: ${DOC}   mode: ${COMMIT ? "COMMIT" : "DRY RUN (no writes)"}   rate: ${RATE}/DC\n`);

  const isSplit = (t) => String(t.memo || "").toLowerCase().includes("split migration");
  const didSplit = (m) =>
    sorted.some((t) => t.type === "CONVERT" && t.currency === "DC" && t.fromEmail === m.email && isSplit(t));

  // resolve member
  let member;
  if (EMAIL) {
    member = members.find((m) => m.email === EMAIL);
    if (!member) throw new Error(`No member with email ${EMAIL}`);
  } else {
    const matches = members.filter((m) => String(m.name || "").toLowerCase().includes(NAME) && didSplit(m));
    if (matches.length === 0) throw new Error(`No migrated member whose name contains "${NAME}". Use --email.`);
    if (matches.length > 1) {
      console.error(`Ambiguous "${NAME}" — ${matches.map((m) => `${m.name} <${m.email}>`).join(", ")}. Use --email.`);
      process.exit(1);
    }
    member = matches[0];
  }
  const email = member.email;

  // locate the split-migration pair + any prior 1:1 correction rows
  const dcOut = sorted.find((t) => t.type === "CONVERT" && t.currency === "DC" && t.fromEmail === email && isSplit(t));
  const ccIn = sorted.find((t) => t.type === "CONVERT" && t.currency === "CC" && t.toEmail === email && isSplit(t));
  if (!dcOut || !ccIn) throw new Error(`${member.name} <${email}> is missing a split-migration CONVERT ${!dcOut ? "DC-out" : "CC-in"} row.`);
  const TAG = `dc-split-1to1 ${email}`;
  const corrections = KEEP_CORRECTIONS ? [] : sorted.filter((t) => String(t.memo || "").includes(TAG));

  // compute the new price + balance delta
  const dcConverted = r2(dcOut.amountCC);
  const oldCC = r2(ccIn.amountCC);
  const newCC = r2(dcConverted * RATE);
  // each correction credited the member (toEmail) or debited (fromEmail); removing it reverses that
  const correctionNet = r2(corrections.reduce(
    (a, t) => a + (t.toEmail === email ? Number(t.amountCC || 0) : t.fromEmail === email ? -Number(t.amountCC || 0) : 0), 0));
  const balanceDelta = r2((newCC - oldCC) - correctionNet);

  console.log(`Member:        ${member.name} <${email}>`);
  console.log(`Migration:     ${dcConverted} DC → ${oldCC} CC   ==>   ${dcConverted} DC → ${newCC} CC  (${RATE}/DC)`);
  if (corrections.length) {
    console.log(`Removing ${corrections.length} correction row(s):`);
    for (const c of corrections) console.log(`   seq ${c.seq}  ${c.toEmail === email ? "+" : "-"}${c.amountCC} CC  "${c.memo}"`);
  } else {
    console.log(`Correction rows: none removed${KEEP_CORRECTIONS ? " (--keep-corrections)" : ""}`);
  }
  console.log(`Balance delta: ${balanceDelta >= 0 ? "+" : ""}${balanceDelta} CC   (${r2(member.balance)} → ${r2(member.balance + balanceDelta)})\n`);

  // build the edited + pruned source, then re-chain
  const dropIds = new Set(corrections.map((t) => t.id));
  const newDcMemo = `Split migration: converted ${dcConverted} DC → ${newCC} CC (${RATE}/DC)`;
  const newCcMemo = `+${newCC} CC from the one-time DC split migration`;
  const src = sorted
    .filter((t) => !dropIds.has(t.id))
    .map((t) => {
      if (t.id === dcOut.id) return { ...t, memo: newDcMemo };
      if (t.id === ccIn.id) return { ...t, amountCC: newCC, memo: newCcMemo };
      return t;
    });
  const rebuilt = rechain(src);

  // SAFETY: rows before the FIRST change must be byte-identical after re-chain.
  const changedSeqs = [dcOut.seq, ccIn.seq, ...corrections.map((c) => c.seq)];
  const firstIdx = sorted.findIndex((t) => t.seq === Math.min(...changedSeqs));
  const prefixOk = rebuilt.slice(0, firstIdx).every((t, i) => t.hash === sorted[i].hash && t.seq === sorted[i].seq);
  if (!prefixOk) { console.error("x SAFETY: re-chain altered a row BEFORE the first change — aborting."); process.exit(1); }
  console.log(`ok rows before seq ${Math.min(...changedSeqs)} are byte-identical after re-chain`);
  console.log(`Transactions: ${sorted.length} → ${rebuilt.length} (removed ${sorted.length - rebuilt.length}, edited 2)\n`);

  if (!COMMIT) { console.log("DRY RUN — nothing written. Re-run with --commit to apply."); process.exit(0); }

  // apply balance + write
  const m = members.find((x) => x.email === email);
  m.balance = r2(m.balance + balanceDelta);
  const next = { ...state, members, transactions: rebuilt };
  const backupPath = path.join(ROOT, "data", `prod-backup-reprice-dcsplit-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, rawLive);
  console.log(`backup written: ${backupPath}`);
  await ref.set({ json: JSON.stringify(next), updatedAt: new Date().toISOString() });
  console.log(`written to ledger/${DOC}: repriced to ${newCC} CC, ${corrections.length} correction row(s) removed, balance ${balanceDelta >= 0 ? "+" : ""}${balanceDelta} CC.`);

  // verify chain + seq
  const after = JSON.parse((await ref.get()).data().json).transactions;
  let prev = "GENESIS", chainOk = true;
  for (const t of after) {
    const p = [t.seq, t.type, t.fromEmail ?? "", t.toEmail ?? "", t.amountCC, t.offerId ?? "", t.createdAt, t.memo].join("|");
    const h = crypto.createHash("sha256").update(`${prev}|${p}`).digest("hex");
    if (h !== t.hash || t.prevHash !== prev) { chainOk = false; break; }
    prev = t.hash;
  }
  const seqOk = after.every((t, idx) => t.seq === idx + 1);
  const gone = corrections.every((c) => !after.some((t) => t.id === c.id));
  console.log(`verify: txs=${after.length}; corrections gone=${gone}; chain valid=${chainOk}; seq contiguous=${seqOk}`);
  process.exit(gone && chainOk && seqOk ? 0 : 1);
})().catch((e) => { console.error("ERR:", (e && e.stack) || e); process.exit(1); });
