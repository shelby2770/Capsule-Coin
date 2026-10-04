#!/usr/bin/env node
/*
 * One-off correction: REFUND the CC a member NET-LOST on the DC venture — the CC they
 * spent buying into DC, minus the CC they got back by converting DC->CC. It does NOT
 * rewrite history (the ledger is a hash chain) — it appends a single corrective
 * ADJUST/CC credit for the net loss, idempotently.
 *
 *   node scripts/refund-dc-buyin.cjs --name Shafi                # dry run (default), find the figure
 *   node scripts/refund-dc-buyin.cjs --email shafi.kader@x.com   # target by exact email
 *   node scripts/refund-dc-buyin.cjs --name Shafi --commit       # apply (backs up first)
 *   node scripts/refund-dc-buyin.cjs --name Shafi --doc capsule_test
 *
 * Flags:
 *   --commit        write to Firestore (default is a dry run that writes nothing)
 *   --email <addr>  target one member by exact email
 *   --name <text>   target one member whose name contains this text (case-insensitive)
 *   --doc <id>      ledger doc id (default "state"; e.g. "capsule_test")
 *   --force         re-apply even if a dc-buyin-refund row already exists for them
 *
 * NET loss = CC_BUY_IN - CC_BACK, where:
 *   CC_BUY_IN (CC spent to get into DC) = the member's BURN/CC rows that bought into DC:
 *     - game entry fees paid in CC  (BURN/CC, memo "…to play…"  -> minted DC)
 *     - mining-pack unlocks paid in CC AFTER mining began minting DC (BURN/CC)
 *     EXCLUDED: the legacy CC<->CC mining loop (mining-pack BURN/CC dated BEFORE the
 *     first MINE/DC row) — pre-dates DC, not a DC buy-in. Also naturally excluded:
 *     post-rework BURN/DC (DC-only spend) and real-money PURCHASE.
 *   CC_BACK (CC recovered from DC) = every CONVERT/CC credited to the member — both the
 *     retired ongoing /convert conversions AND the one-time split migration (repriced).
 * The legacy boundary is the earliest MINE/DC createdAt in the whole ledger.
 *
 * Only a POSITIVE net loss is refunded (if conversions >= buy-in, they came out ahead,
 * so nothing is credited). Held DC (play-only, no CC cost) is outside this CC P&L.
 *
 * Hash chain matches store.appendTransaction: payload =
 *   [seq,type,fromEmail,toEmail,amountCC,offerId,createdAt,memo] joined by "|";
 *   hash = sha256(prevHash + "|" + payload). Currency is NOT hashed. The row is
 *   appended, so existing hashes are untouched; the chain is re-verified before exit.
 * CC-only, so the DC reserve (reserveRemaining counts only DC) is untouched.
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
const EMAIL = (opt("email") || "").trim().toLowerCase();
const NAME = (opt("name") || "").trim().toLowerCase();
const r2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;
const cur = (t) => t.currency || "CC";
const dt = (s) => String(s || "").replace("T", " ").replace(/\..*$/, "").replace("Z", "");

if (!EMAIL && !NAME) { console.error("Pick the member: --email <addr> or --name <text>."); process.exit(1); }

(async () => {
  const ref = db.collection("ledger").doc(DOC);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`No ledger/${DOC}`);
  const rawLive = snap.data().json;
  const state = JSON.parse(rawLive);
  const members = state.members || [];
  const txs = [...(state.transactions || [])].sort((a, b) => a.seq - b.seq);

  console.log(`ledger: ${DOC}   mode: ${COMMIT ? "COMMIT" : "DRY RUN (no writes)"}\n`);

  // resolve member
  let member;
  if (EMAIL) {
    member = members.find((m) => m.email === EMAIL);
    if (!member) throw new Error(`No member with email ${EMAIL}`);
  } else {
    const matches = members.filter((m) => String(m.name || "").toLowerCase().includes(NAME));
    if (matches.length === 0) throw new Error(`No member whose name contains "${NAME}". Use --email.`);
    if (matches.length > 1) {
      console.error(`Ambiguous "${NAME}" — ${matches.map((m) => `${m.name} <${m.email}>`).join(", ")}. Use --email.`);
      process.exit(1);
    }
    member = matches[0];
  }
  const email = member.email;
  const from = (t) => t.fromEmail === email;
  const to = (t) => t.toEmail === email;

  // legacy boundary: when mining flipped CC -> DC (earliest MINE/DC in the whole ledger)
  const dcMineRows = txs.filter((t) => t.type === "MINE" && cur(t) === "DC");
  const dcMiningStart = dcMineRows.length ? dcMineRows.map((t) => t.createdAt).sort()[0] : null;

  // ── CC_BUY_IN: BURN/CC that bought into DC (legacy CC-mining excluded) ──
  const burnCc = txs.filter((t) => t.type === "BURN" && cur(t) === "CC" && from(t));
  const catOf = (t) => {
    const m = String(t.memo || "").toLowerCase();
    if (m.includes("to play")) return "game";
    if (m.includes("unlock") || m.includes("mining")) return "mining";
    return "other";
  };
  const isLegacyMining = (t) => catOf(t) === "mining" && dcMiningStart && t.createdAt < dcMiningStart;
  const buyRows = burnCc.filter((t) => !isLegacyMining(t));
  const legacyRows = burnCc.filter(isLegacyMining);
  const buyIn = r2(buyRows.reduce((a, t) => a + Number(t.amountCC || 0), 0));
  const ccLegacy = r2(legacyRows.reduce((a, t) => a + Number(t.amountCC || 0), 0));

  // ── CC_BACK: every CONVERT/CC credited to the member (ongoing + split migration) ──
  const convRows = txs.filter((t) => t.type === "CONVERT" && cur(t) === "CC" && to(t));
  const ccBack = r2(convRows.reduce((a, t) => a + Number(t.amountCC || 0), 0));

  const netLoss = r2(buyIn - ccBack);
  const refund = Math.max(0, netLoss);

  console.log(`Member: ${member.name} <${email}>`);
  console.log(`Current balance: ${r2(member.balance)} CC · ${r2(member.dcBalance)} DC`);
  console.log(`DC-mining began: ${dcMiningStart ? dt(dcMiningStart) : "n/a"} UTC (legacy CC-mining is anything before this)\n`);

  console.log(`CC BUY-IN into DC — ${buyRows.length} BURN/CC rows (legacy CC-mining excluded):`);
  const ccGame = r2(buyRows.filter((t) => catOf(t) === "game").reduce((a, t) => a + Number(t.amountCC || 0), 0));
  const ccMiningDc = r2(buyRows.filter((t) => catOf(t) === "mining").reduce((a, t) => a + Number(t.amountCC || 0), 0));
  const ccOther = r2(buyRows.filter((t) => catOf(t) === "other").reduce((a, t) => a + Number(t.amountCC || 0), 0));
  console.log(`   game entry fees        -${ccGame} CC`);
  console.log(`   mining packs (DC-era)  -${ccMiningDc} CC`);
  if (ccOther) console.log(`   other CC burns         -${ccOther} CC`);
  console.log(`   = CC spent buying into DC: ${buyIn} CC\n`);

  console.log(`CC RECOVERED from DC — ${convRows.length} CONVERT/CC rows:`);
  if (convRows.length === 0) console.log("   (none)");
  for (const t of convRows) console.log(`   seq ${String(t.seq).padStart(4)}  ${dt(t.createdAt)}  +${r2(t.amountCC)} CC  ${t.memo || ""}`);
  console.log(`   = CC got back via conversions: ${ccBack} CC\n`);

  console.log(`   ${"-".repeat(40)}`);
  console.log(`   NET from DC venture: ${ccBack} back - ${buyIn} in = ${r2(ccBack - buyIn)} CC`);
  console.log(`   => ${netLoss > 0 ? `NET LOSS ${netLoss} CC  <= refund amount` : netLoss < 0 ? `NET PROFIT ${-netLoss} CC — nothing to refund` : "break-even — nothing to refund"}`);
  if (legacyRows.length) console.log(`   (legacy CC<->CC mining of ${ccLegacy} CC over ${legacyRows.length} rows is excluded, as agreed)`);
  if (r2(member.dcBalance) > 0) console.log(`   (note: ${r2(member.dcBalance)} DC still held is play-only, outside this CC P&L)`);
  console.log("");

  // idempotency
  const TAG = `dc-buyin-refund ${email}`;
  const already = txs.some((t) => String(t.memo || "").includes(TAG));
  if (already && !FORCE) {
    console.log(`SKIP: a "${TAG}" row already exists. Re-run with --force to add another.`);
    process.exit(0);
  }
  if (refund <= 0) { console.log("Nothing to refund."); process.exit(0); }

  console.log(`Plan: append ADJUST/CC +${refund} to ${member.name}; balance ${r2(member.balance)} -> ${r2(member.balance + refund)} CC.\n`);
  if (!COMMIT) { console.log("DRY RUN — nothing written. Re-run with --commit to apply."); process.exit(0); }

  // append one ADJUST/CC credit + bump balance
  const m = members.find((x) => x.email === email);
  const prevHash = txs.length ? txs[txs.length - 1].hash : "GENESIS";
  const seq = (txs.length ? txs[txs.length - 1].seq : 0) + 1;
  const createdAt = new Date().toISOString();
  const memo = `DC venture net-loss refund (${TAG}): CC buy-in ${buyIn} - DC->CC conversions ${ccBack} = ${netLoss} CC net loss, credited back`;
  const payload = [seq, "ADJUST", "", email, refund, "", createdAt, memo].join("|");
  const hash = crypto.createHash("sha256").update(`${prevHash}|${payload}`).digest("hex");
  txs.push({
    seq, id: crypto.randomUUID(), type: "ADJUST", currency: "CC",
    fromEmail: null, toEmail: email, amountCC: refund, offerId: null,
    memo, createdAt, prevHash, hash, externalId: null,
  });
  m.balance = r2(m.balance + refund);

  // backup + write
  const backupPath = path.join(ROOT, "data", `prod-backup-dcbuyin-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, rawLive);
  console.log(`backup written: ${backupPath}`);
  const next = { ...state, members, transactions: txs };
  await ref.set({ json: JSON.stringify(next), updatedAt: new Date().toISOString() });
  console.log(`written to ledger/${DOC}: +1 ADJUST/CC row, +${refund} CC to ${member.name} (now ${r2(m.balance)} CC).`);

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
  console.log(`verify: txs=${after.length}; chain valid=${chainOk}; seq contiguous=${seqOk}`);
  process.exit(chainOk && seqOk ? 0 : 1);
})().catch((e) => { console.error("ERR:", (e && e.stack) || e); process.exit(1); });
