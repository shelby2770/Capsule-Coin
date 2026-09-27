#!/usr/bin/env node
/*
 * One-off correction: make the one-time DC->CC split migration settle at a flat 1:1
 * rate instead of the rate-curve amount members actually received. It does NOT
 * rewrite history (the ledger is a hash chain) — it appends a corrective ADJUST/CC
 * credit for the shortfall:  topUp = dcConverted - ccReceived  (only positives).
 *
 *   node scripts/fix-dc-split-1to1.cjs --name Shafi                # dry run, one member
 *   node scripts/fix-dc-split-1to1.cjs --email shafi.kader@x.com   # target by exact email
 *   node scripts/fix-dc-split-1to1.cjs --all                       # dry run, everyone who migrated
 *   node scripts/fix-dc-split-1to1.cjs --all --commit              # apply to everyone (backs up first)
 *   node scripts/fix-dc-split-1to1.cjs --name Shafi --commit       # apply to one member
 *   node scripts/fix-dc-split-1to1.cjs --all --doc capsule_test    # test namespace
 *
 * Flags:
 *   --commit        write to Firestore (default is a dry run that writes nothing)
 *   --all           correct EVERY member who did the split migration (ignores --name/--email)
 *   --email <addr>  target one member by exact email
 *   --name <text>   target one member whose name contains this text (case-insensitive);
 *                   errors if it matches zero or more than one migrated member
 *   --doc <id>      ledger doc id (default "state"; e.g. "capsule_test")
 *   --force         re-apply even to members who already have a 1:1 correction row
 *
 * Source of truth is each member's SPLIT-migration CONVERT pair (store.markDcSplitChoice):
 *   - DC-out leg: type CONVERT, currency DC, fromEmail = member, amountCC = DC converted
 *   - CC-in  leg: type CONVERT, currency CC, toEmail  = member, amountCC = CC received
 * The migration is told apart from the RETIRED ongoing /convert conversions purely by
 * its memo ("… split migration …"), so a member who also used the old converter isn't
 * matched on the wrong CONVERT row. Target CC at 1:1 = DC converted; top-up is the
 * difference. CC-only, so the DC reserve (reserveRemaining counts only DC) is untouched.
 *
 * Hash chain matches store.appendTransaction: payload =
 *   [seq,type,fromEmail,toEmail,amountCC,offerId,createdAt,memo] joined by "|";
 *   hash = sha256(prevHash + "|" + payload). Currency is NOT hashed. Rows are
 *   appended, so existing hashes are untouched; the chain is re-verified before exit.
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
const FORCE = flag("force");
const ALL = flag("all");
const EMAIL = (opt("email") || "").trim().toLowerCase();
const NAME = (opt("name") || "").trim().toLowerCase();
const r2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;

if (!ALL && !EMAIL && !NAME) {
  console.error("Pick who to correct: --all, or --email <addr>, or --name <text>.");
  process.exit(1);
}

(async () => {
  const ref = db.collection("ledger").doc(DOC);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`No ledger/${DOC}`);
  const rawLive = snap.data().json;
  const state = JSON.parse(rawLive);
  const members = state.members || [];
  const txs = [...(state.transactions || [])].sort((a, b) => a.seq - b.seq);

  console.log(`ledger: ${DOC}   mode: ${COMMIT ? "COMMIT" : "DRY RUN (no writes)"}   scope: ${ALL ? "ALL migrated members" : "single member"}\n`);

  // The one-time split migration is distinguished from the OLD ongoing /convert
  // conversions purely by its memo (store.markDcSplitChoice writes "Split migration:
  // converted …" / "… from the one-time DC split migration"; the retired ongoing
  // converter wrote "Converted …" / "… from converting …"). Match on that so a
  // member who ALSO used the old converter isn't picked up by the wrong CONVERT row.
  const isSplit = (t) => String(t.memo || "").toLowerCase().includes("split migration");
  const didSplit = (m) =>
    txs.some((t) => t.type === "CONVERT" && t.currency === "DC" && t.fromEmail === m.email && isSplit(t));

  // Compute the 1:1 correction for one member from their split-migration pair.
  function correctionFor(m) {
    const email = m.email;
    const dcOut = txs.find((t) => t.type === "CONVERT" && t.currency === "DC" && t.fromEmail === email && isSplit(t));
    if (!dcOut) return null; // this member never did the split migration
    const ccIn = txs.find((t) => t.type === "CONVERT" && t.currency === "CC" && t.toEmail === email && isSplit(t));
    const dcConverted = r2(dcOut.amountCC);
    const ccReceived = r2(ccIn ? ccIn.amountCC : 0);
    const target = dcConverted; // 1:1
    const topUp = r2(target - ccReceived);
    const TAG = `dc-split-1to1 ${email}`;
    const already = txs.some((t) => String(t.memo || "").includes(TAG));
    return { m, email, dcConverted, ccReceived, target, topUp, TAG, already };
  }

  // 1) resolve the target member(s)
  let targets;
  if (ALL) {
    targets = members.filter(didSplit);
    if (targets.length === 0) throw new Error("No members have a one-time DC split migration.");
  } else if (EMAIL) {
    const m = members.find((x) => x.email === EMAIL);
    if (!m) throw new Error(`No member with email ${EMAIL}`);
    targets = [m];
  } else {
    const matches = members.filter((m) => String(m.name || "").toLowerCase().includes(NAME) && didSplit(m));
    if (matches.length === 0) throw new Error(`No migrated member whose name contains "${NAME}". Use --email.`);
    if (matches.length > 1) {
      console.error(`Ambiguous "${NAME}" — matches: ${matches.map((m) => `${m.name} <${m.email}>`).join(", ")}`);
      console.error("Re-run with --email to disambiguate.");
      process.exit(1);
    }
    targets = matches;
  }

  // 2) compute corrections + print the table
  const rows = targets.map(correctionFor).filter(Boolean);
  const toApply = [];
  console.log(`${"member".padEnd(34)} ${"DC→CC (migration)".padEnd(22)} ${"→ 1:1".padEnd(10)} top-up    status`);
  for (const c of rows) {
    let status;
    if (c.already && !FORCE) status = "SKIP (already corrected)";
    else if (c.topUp <= 0) status = "skip (>= 1:1 already)";
    else { status = c.already ? "APPLY (again, --force)" : "APPLY"; toApply.push(c); }
    const label = `${c.m.name} <${c.email}>`;
    console.log(
      `${label.slice(0, 33).padEnd(34)} ${`${c.dcConverted} DC → ${c.ccReceived} CC`.padEnd(22)} ` +
      `${`${c.target} CC`.padEnd(10)} ${`+${c.topUp}`.padStart(8)}  ${status}`,
    );
  }
  const totalCC = r2(toApply.reduce((a, c) => a + c.topUp, 0));
  console.log(`\nTo apply: ${toApply.length} member(s), +${totalCC} CC total.\n`);

  if (toApply.length === 0) { console.log("Nothing to apply."); process.exit(0); }
  if (!COMMIT) { console.log("DRY RUN — nothing written. Re-run with --commit to apply."); process.exit(0); }

  // 3) append one ADJUST/CC credit per member + bump each CC balance
  const byEmail = new Map(members.map((m) => [m.email, m]));
  let prevHash = txs.length ? txs[txs.length - 1].hash : "GENESIS";
  let seq = txs.length ? txs[txs.length - 1].seq : 0;
  const now = Date.now();
  let i = 0, applied = 0, minted = 0;
  for (const c of toApply) {
    const m = byEmail.get(c.email);
    if (!m) { console.log(`  ! ${c.email} isn't a current member — skipping +${c.topUp} CC`); continue; }
    seq += 1;
    const createdAt = new Date(now + i++).toISOString();
    const memo = `1:1 DC split correction (${c.TAG}): migration was ${c.dcConverted} DC -> ${c.ccReceived} CC; topped up +${c.topUp} CC to reach 1:1 (${c.target} CC)`;
    const payload = [seq, "ADJUST", "", c.email, c.topUp, "", createdAt, memo].join("|");
    const hash = crypto.createHash("sha256").update(`${prevHash}|${payload}`).digest("hex");
    txs.push({
      seq, id: crypto.randomUUID(), type: "ADJUST", currency: "CC",
      fromEmail: null, toEmail: c.email, amountCC: c.topUp, offerId: null,
      memo, createdAt, prevHash, hash, externalId: null,
    });
    prevHash = hash;
    m.balance = r2(m.balance + c.topUp);
    minted = r2(minted + c.topUp);
    applied += 1;
  }

  // 4) backup + write
  const backupPath = path.join(ROOT, "data", `prod-backup-dcsplit1to1-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, rawLive);
  console.log(`backup written: ${backupPath}`);
  const next = { ...state, members, transactions: txs };
  await ref.set({ json: JSON.stringify(next), updatedAt: new Date().toISOString() });
  console.log(`written to ledger/${DOC}: +${applied} ADJUST/CC row(s), +${minted} CC total.`);

  // 5) verify chain + seq
  const after = JSON.parse((await ref.get()).data().json).transactions;
  let prev = "GENESIS", chainOk = true;
  for (const t of after) {
    const p = [t.seq, t.type, t.fromEmail ?? "", t.toEmail ?? "", t.amountCC, t.offerId ?? "", t.createdAt, t.memo].join("|");
    const h = crypto.createHash("sha256").update(`${prev}|${p}`).digest("hex");
    if (h !== t.hash || t.prevHash !== prev) { chainOk = false; break; }
    prev = t.hash;
  }
  const seqOk = after.every((t, idx) => t.seq === idx + 1);
  console.log(`verify: txs=${after.length}; chain valid=${chainOk}; seq contiguous=${seqOk}`);
  process.exit(chainOk && seqOk ? 0 : 1);
})().catch((e) => { console.error("ERR:", (e && e.stack) || e); process.exit(1); });
