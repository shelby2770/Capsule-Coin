#!/usr/bin/env node
/**
 * One-off: remove Adnan's TEST MINING from a ledger doc. The test rows are the
 * contiguous MINE/BURN block at the TAIL of the chain (Adnan has no legitimate
 * mining), so they truncate cleanly with no re-hashing. Adnan's stored balance /
 * dcBalance are corrected by reversing the exact effect of each removed row.
 *
 *   node scripts/remove-test-mining.cjs <docId> [--commit]
 *
 *   docId    "capsule_test" (local) or "state" (PROD)
 *   --commit actually write (default = dry run, prints what it WOULD do)
 *
 * For docId "state" with --commit, the prod Google Sheet is re-mirrored so the
 * removed rows disappear from the Mining/Transactions tabs too.
 * A full JSON backup is written before any write.
 */
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");
const admin = require("firebase-admin");
const svc = require(path.join(__dirname, "..", "capsule-coin-firebase-adminsdk-fbsvc-fea87c9661.json"));
admin.initializeApp({ credential: admin.credential.cert(svc), projectId: "capsule-coin" });
const db = admin.firestore();

const ME = "adnan.istiaque@orbitax.com";
const DOC = process.argv[2];
const COMMIT = process.argv.includes("--commit");
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

if (!DOC || (DOC !== "capsule_test" && DOC !== "state")) {
  console.error('Usage: node scripts/remove-test-mining.cjs <capsule_test|state> [--commit]');
  process.exit(1);
}

// ── prod Google Sheet re-mirror (copied verbatim from scripts/add-trade.cjs) ──
const SHEET_ID = process.env.GOOGLE_SHEETS_ID || "1dCsaa9TtbfNeTC-l8Qa_X9NFB8N0-U7MgG6Lb_pVoI0";
const r4 = (x) => Math.round(x * 1e4) / 1e4, r1 = (x) => Math.round(x * 10) / 10;
const bdt = (iso) => { if (!iso) return ""; const d = new Date(new Date(iso).getTime() + 6 * 3600000); return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16).replace("T", " "); };
const C = { bdtMin: 0.5, bdtMax: 10, spreadScale: 180, usdBdtRate: 120, power: 0.5 };
function balancesAt(state, t) {
  const b = new Map(state.members.map((m) => [m.email, 0]));
  for (const tx of state.transactions) {
    const ts = Date.parse(tx.createdAt); if (isNaN(ts) || ts > t) continue;
    if (tx.toEmail && b.has(tx.toEmail)) b.set(tx.toEmail, b.get(tx.toEmail) + tx.amountCC);
    if (tx.fromEmail && b.has(tx.fromEmail)) b.set(tx.fromEmail, b.get(tx.fromEmail) - tx.amountCC);
  }
  return [...b.values()];
}
const stddev = (v) => { if (!v.length) return 0; const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); };
const bdtAt = (s, t) => { const sd = stddev(balancesAt(s, t)); const raw = C.bdtMin + (C.bdtMax - C.bdtMin) * (1 - Math.exp(-sd / (C.spreadScale || 1))); return Math.pow(raw, C.power); };
async function syncSheet(state) {
  const now = Date.now();
  const bdtPerCC = round2(bdtAt(state, now));
  const usdPerCC = r4(bdtPerCC / C.usdBdtRate);
  const spread = r1(stddev(balancesAt(state, now)));
  const circulating = state.members.reduce((s, m) => s + Math.max(0, m.balance), 0);
  const circulatingDc = state.members.reduce((s, m) => s + Math.max(0, m.dcBalance || 0), 0);
  const standingOf = (m) => (m.banned ? "BANNED" : m.graceUntil ? "GRACE" : "OK");
  const nameOf = (e) => (e ? (state.members.find((x) => x.email === e)?.name || e) : "");
  const auth = new google.auth.JWT({ email: svc.client_email, key: svc.private_key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const TABS = ["Value", "Members", "Mining", "Transactions", "Requests"];
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const have = new Set((meta.data.sheets || []).map((s) => s.properties.title));
  const missing = TABS.filter((t) => !have.has(t));
  if (missing.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) } });
  const valueRows = [
    ["Capsule Coin — live mirror", ""], ["Generated (UTC+6)", bdt(new Date(now).toISOString())],
    ["1 CC (BDT)", bdtPerCC], ["1 CC (USD)", usdPerCC], ["Balance spread (σ)", spread],
    ["Circulating supply (CC)", circulating], ["Circulating DC", circulatingDc], ["Transactions", state.transactions.length],
    ["Members joined", state.members.filter((m) => m.verified).length],
    ["Note", "Auto-synced by the Capsule Coin server after every change. Read-only mirror — the app is the source of truth."],
  ];
  const memberRows = [["Email", "Name", "Role", "Balance (CC)", "DC", "Joined", "Standing", "Last Mined (UTC+6)"],
    ...[...state.members].sort((a, b) => b.balance - a.balance).map((m) => [m.email, m.name, m.role, m.balance, m.dcBalance || 0, m.verified ? "yes" : "no", standingOf(m), bdt(m.lastMinedAt)])];
  const mineRows = [["Seq", "Miner", "Amount", "Currency", "Memo", "Created (UTC+6)", "Hash"],
    ...state.transactions.filter((t) => t.type === "MINE").map((t) => [t.seq, nameOf(t.toEmail), t.amountCC, t.currency || "CC", t.memo, bdt(t.createdAt), t.hash])];
  const txRows = [["Seq", "Type", "Currency", "From", "To", "Amount", "Memo", "Created (UTC+6)", "Hash"],
    ...state.transactions.filter((t) => t.type !== "MINE").map((t) => [t.seq, t.type, t.currency || "CC", nameOf(t.fromEmail), nameOf(t.toEmail), t.amountCC, t.memo, bdt(t.createdAt), t.hash])];
  const reqRows = [["ID", "Payer", "Payee", "Amount (CC)", "Item", "Note", "Status", "Created (UTC+6)", "Resolved (UTC+6)"],
    ...state.transfers.map((r) => [r.id, r.fromName, r.toName, r.amountCC, r.item, r.note, r.status, bdt(r.createdAt), bdt(r.resolvedAt)])];
  await sheets.spreadsheets.values.batchClear({ spreadsheetId: SHEET_ID, requestBody: { ranges: TABS } });
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: "RAW", data: [
    { range: "Value!A1", values: valueRows }, { range: "Members!A1", values: memberRows },
    { range: "Mining!A1", values: mineRows },
    { range: "Transactions!A1", values: txRows }, { range: "Requests!A1", values: reqRows },
  ] } });
  return bdtPerCC;
}

(async () => {
  const ref = db.collection("ledger").doc(DOC);
  const snap = await ref.get();
  if (!snap.exists) { console.error("No ledger doc at ledger/" + DOC); process.exit(1); }
  const rawJson = snap.data().json;
  const state = JSON.parse(rawJson);
  const txs = state.transactions || [];

  // Collect the contiguous TAIL block of Adnan MINE/BURN rows.
  const isTestRow = (t) => (t.type === "MINE" && t.toEmail === ME) || (t.type === "BURN" && t.fromEmail === ME);
  const block = [];
  for (let i = txs.length - 1; i >= 0; i--) {
    if (isTestRow(txs[i])) block.unshift(txs[i]); else break;
  }
  if (!block.length) { console.log(`ledger/${DOC}: no trailing Adnan test-mining rows. Nothing to do.`); process.exit(0); }

  // Safety: every collected row must be Adnan's and MINE/BURN only.
  if (!block.every(isTestRow)) { console.error("✗ Safety check failed — block contains a non-test row."); process.exit(1); }

  const me = state.members.find((m) => m.email === ME);
  if (!me) { console.error("✗ Adnan not found in members."); process.exit(1); }

  let dcMined = 0, ccMined = 0, ccBurned = 0;
  for (const t of block) {
    if (t.type === "MINE") { if ((t.currency || "CC") === "DC") dcMined += Number(t.amountCC || 0); else ccMined += Number(t.amountCC || 0); }
    else if (t.type === "BURN") ccBurned += Number(t.amountCC || 0);
  }
  const oldBal = round2(me.balance || 0), oldDc = round2(me.dcBalance || 0);
  const newBal = round2(oldBal - ccMined + ccBurned); // reverse: undo CC credited, refund CC burned
  const newDc = round2(oldDc - dcMined); // reverse: undo DC credited

  console.log(`ledger/${DOC}: removing ${block.length} trailing test rows (seq ${block[0].seq}..${block[block.length-1].seq}):`);
  for (const t of block) console.log(`   seq#${t.seq} ${t.type} ${t.currency||"CC"} ${round2(t.amountCC)}  "${t.memo||""}"`);
  console.log(`   reversed: dcMined=${round2(dcMined)} ccMined=${round2(ccMined)} ccBurned=${round2(ccBurned)}`);
  console.log(`   Adnan balance ${oldBal} -> ${newBal} CC ;  dcBalance ${oldDc} -> ${newDc} DC`);
  console.log(`   transactions ${txs.length} -> ${txs.length - block.length}`);

  if (!COMMIT) { console.log("\nDRY RUN — pass --commit to write. Nothing changed."); process.exit(0); }

  const backupPath = path.join(__dirname, "..", "data", `backup-${DOC}-remove-testmine-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, rawJson);
  console.log("\nBackup: " + backupPath);

  state.transactions = txs.slice(0, txs.length - block.length);
  me.balance = newBal;
  me.dcBalance = newDc;
  await ref.set({ json: JSON.stringify(state), updatedAt: new Date().toISOString() });
  console.log(`✅ Wrote ledger/${DOC} (removed ${block.length} rows, Adnan restored to ${newBal} CC / ${newDc} DC).`);

  if (DOC === "state") {
    try { const bdtPerCC = await syncSheet(state); console.log(`✅ Prod Google Sheet re-mirrored (1 CC ≈ ৳${bdtPerCC}). Mining/Transactions tabs no longer show the test rows.`); }
    catch (e) { console.error("⚠ Sheet re-sync FAILED (ledger IS fixed):", e.message, "\n  Re-run a sync or it'll refresh on the next prod write."); }
  }
  process.exit(0);
})().catch((e) => { console.error("ERR:", e && e.message ? e.message : e); process.exit(1); });
