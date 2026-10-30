#!/usr/bin/env node
/**
 * Manual Capsule Coin trade entry.
 *
 *   node scripts/add-trade.cjs <sender> <receiver> <cc> <food...>
 *
 *   sender   = who PAYS the CC  (the buyer)   -> ledger "From"
 *   receiver = who GETS the CC  (the seller)  -> ledger "To"
 *   cc       = amount (positive number)
 *   food     = item name (may be several words)
 *
 * Time = now, or pass --date <ISO> (e.g. --date 2026-10-29T14:09:00+06:00) to
 * backdate it. A member record is created automatically if a party has none yet.
 * Appends a TRANSFER with memo "<food> · via DesertHouse", writes to
 * Firestore (source of truth) AND re-syncs the Capsule Currency Google Sheet, so
 * a row like  59  TRANSFER  <From>  <To>  <cc>  <food> · via DesertHouse  <time>  <hash>
 * appears automatically. Names accept first name / nickname / email (e.g. Ishtiaq,
 * Swaad, shafi, riaz.khan@orbitax.com). A one-file backup is written before each run.
 *
 * Example (Shafi sold Burger to Ishtiaq for 15):
 *   node scripts/add-trade.cjs Ishtiaq Shafi 15 Burger
 */
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");
const admin = require("firebase-admin");
const crypto = require("crypto");
const svc = require(path.join(__dirname, "..", "capsule-coin-firebase-adminsdk-fbsvc-fea87c9661.json"));
admin.initializeApp({ credential: admin.credential.cert(svc), projectId: "capsule-coin" });
const db = admin.firestore();

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || "1dCsaa9TtbfNeTC-l8Qa_X9NFB8N0-U7MgG6Lb_pVoI0";
const LEDGER_DOC = process.env.LEDGER_DOC_ID || "state";
const TAG = " · via DesertHouse";
const BACKUP = path.join(__dirname, "..", "data", "prod-backup-last.json");

const round2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 1e4) / 1e4, r1 = (x) => Math.round(x * 10) / 10;
const bdt = (iso) => { if (!iso) return ""; const d = new Date(new Date(iso).getTime() + 6 * 3600000); return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16).replace("T", " "); };

// Roster: local-part -> aliases (first name / nickname). Mirrors lib/allowlist.ts.
const ALIASES = {
  "fayjul.islam": ["fayjul"], "adnan.istiaque": ["adnan"], "ashap.bappy": ["ashap", "bappy"],
  "asish.pal": ["asish"], "enamul.hasan": ["enamul", "enam"], "ishtiaq.samiul": ["ishtiaq", "samiul", "ishtiak"],
  "mujahedul.azad": ["mujahedul", "turin"], "amdadul.haque": ["amdadul", "amdad"], "jakir.hossen": ["jakir", "shagor"],
  "mainul.ahsan": ["mainul", "swaad"], "masum.billah": ["masum"], "nayeem.hossain": ["nayeem"],
  "prottya.roy": ["prottya"], "riaz.khan": ["riaz"], "sabbir.hasan": ["sabbir"], "shafi.kader": ["shafi", "sopan"],
  "asif.anwar": ["asif", "anwar"], "mamun.hossain": ["mamun"], "rejwanul.haque": ["rejwanul", "rajon"],
  "rifatul.islam": ["rifatul", "rifat"], "shuhayel.shanto": ["shuhayel", "shanto"], "mestu.paul": ["mestu"],
  "radoan.nabil": ["radoan", "nabil"], "ridwanur.siam": ["ridwanur", "siam"],
};
const NAMES = {
  "fayjul.islam": "Fayjul Islam", "adnan.istiaque": "Adnan Istiaque", "ashap.bappy": "Ashap Bappy",
  "asish.pal": "Asish Pal", "enamul.hasan": "Enamul Hasan", "ishtiaq.samiul": "Ishtiaq Samiul",
  "mujahedul.azad": "Md Mujahedul Azad (Turin)", "amdadul.haque": "Md. Amdadul Haque", "jakir.hossen": "Md. Jakir Hossen Shagor",
  "mainul.ahsan": "Md. Mainul Ahsan \"Swaad\"", "masum.billah": "Md. Masum Billah", "nayeem.hossain": "Nayeem Hossain",
  "prottya.roy": "Prottya Roy", "riaz.khan": "Riaz Khan", "sabbir.hasan": "Sabbir Hasan", "shafi.kader": "Shafi Al Kader (Sopan)",
  "asif.anwar": "Asif Anwar", "mamun.hossain": "Mamun Hossain", "rejwanul.haque": "Md. Rejwanul Haque (Rajon)",
  "rifatul.islam": "Md. Rifatul Islam", "shuhayel.shanto": "Md. Shuhayel Alom Shanto", "mestu.paul": "Mestu Paul",
  "radoan.nabil": "Radoan Islam Nabil", "ridwanur.siam": "Ridwanur Rashid Siam",
};
// Role assigned if a trade has to CREATE a missing member record (mirrors lib/allowlist.ts).
const ROLES = {
  "fayjul.islam": "Software Engineer", "adnan.istiaque": "Associate Software Engineer",
  "ashap.bappy": "Software Engineer", "asish.pal": "Software Architect",
  "enamul.hasan": "Associate Software Engineer", "ishtiaq.samiul": "Associate Software Engineer",
  "mujahedul.azad": "Software Engineer", "amdadul.haque": "Associate Software Engineer",
  "jakir.hossen": "Software Engineer", "mainul.ahsan": "Associate Software Engineer",
  "masum.billah": "Software Engineer", "nayeem.hossain": "Software Engineer",
  "prottya.roy": "Software Engineer", "riaz.khan": "Associate Software Engineer",
  "sabbir.hasan": "Associate Software Engineer", "shafi.kader": "Principal Software Engineer",
  "asif.anwar": "Associate Software Engineer", "mamun.hossain": "Principal Software Engineer",
  "rejwanul.haque": "Associate Software Engineer", "rifatul.islam": "Software Engineer",
  "shuhayel.shanto": "Associate Software Engineer", "mestu.paul": "Software Engineer",
  "radoan.nabil": "Associate Software Engineer", "ridwanur.siam": "Associate Software Engineer",
};
function resolve(input) {
  let s = String(input || "").trim().toLowerCase().replace(/^@/, "");
  if (s.includes("@")) s = s.split("@")[0];
  if (ALIASES[s]) return s + "@orbitax.com";
  for (const [lp, al] of Object.entries(ALIASES)) {
    if (lp === s || al.includes(s) || lp.split(".").includes(s)) return lp + "@orbitax.com";
  }
  return null;
}
const nm = (email) => NAMES[String(email).split("@")[0]] || email;

// ── Google Sheet sync (mirrors lib/sheets/sync.ts doSync) ────────────────────
const C = { bdtMin: 0.5, bdtMax: 10, spreadScale: 180, usdBdtRate: 120, power: 0.5 };
const DAY = 86_400_000;
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
  // Pull an optional --date/--at <ISO> out of argv; the rest is positional.
  const argvAll = process.argv.slice(2);
  let DATE = null;
  const argv = [];
  for (let i = 0; i < argvAll.length; i++) {
    if (argvAll[i] === "--date" || argvAll[i] === "--at") { DATE = argvAll[++i]; continue; }
    argv.push(argvAll[i]);
  }
  const [aSender, aReceiver, aCc, ...aFood] = argv;
  const food = (aFood.join(" ") || "").trim();
  const cc = round2(Number(aCc));
  if (!aSender || !aReceiver || !aCc || !food) {
    console.log("Usage: node scripts/add-trade.cjs <sender> <receiver> <cc> <food...>");
    console.log("  sender   = who PAYS the CC (buyer)   -> ledger \"From\"");
    console.log("  receiver = who GETS the CC (seller)  -> ledger \"To\"");
    console.log("  --date <ISO>  optional: backdate, e.g. --date 2026-10-29T14:09:00+06:00");
    console.log("Example: node scripts/add-trade.cjs Ishtiaq Shafi 15 Burger   (Shafi sold Burger to Ishtiaq for 15)");
    process.exit(1);
  }
  const from = resolve(aSender), to = resolve(aReceiver);
  if (!from) { console.error("✗ Unknown sender: \"" + aSender + "\" (use a first name, nickname, or email)"); process.exit(1); }
  if (!to) { console.error("✗ Unknown receiver: \"" + aReceiver + "\""); process.exit(1); }
  if (from === to) { console.error("✗ Sender and receiver are the same person."); process.exit(1); }
  if (!Number.isFinite(cc) || cc <= 0) { console.error("✗ cc must be a positive number."); process.exit(1); }
  const memo = food + TAG;
  let createdAt;
  if (DATE) {
    const d = new Date(DATE);
    if (isNaN(d.getTime())) {
      console.error("✗ --date is not a valid date: \"" + DATE + "\" (e.g. 2026-10-29T14:09:00+06:00)");
      process.exit(1);
    }
    createdAt = d.toISOString();
  } else {
    createdAt = new Date().toISOString();
  }
  const ref = db.collection("ledger").doc(LEDGER_DOC);

  // one-file backup before writing
  try { fs.mkdirSync(path.dirname(BACKUP), { recursive: true }); fs.writeFileSync(BACKUP, (await ref.get()).data().json); } catch (e) { console.error("(backup skipped:", e.message + ")"); }

  const res = await db.runTransaction(async (tx) => {
    const state = JSON.parse((await tx.get(ref)).data().json);
    const txs = state.transactions;
    const prev = txs.length ? txs[txs.length - 1].hash : "GENESIS";
    const seq = txs.length + 1;
    const payload = [seq, "TRANSFER", from, to, cc, "", createdAt, memo].join("|");
    const hash = crypto.createHash("sha256").update(prev + "|" + payload).digest("hex");
    txs.push({ seq, id: crypto.randomUUID(), type: "TRANSFER", currency: "CC", fromEmail: from, toEmail: to, amountCC: cc, offerId: null, memo, createdAt, prevHash: prev, hash, externalId: null });
    const byE = Object.fromEntries(state.members.map((m) => [m.email, m]));
    // Create a member record on the fly if this person has never been seen (e.g. a
    // newer member who hasn't signed in yet), mirroring store.ensureMemberDraft.
    const ensure = (email) => {
      if (byE[email]) return byE[email];
      const lp = email.split("@")[0];
      const nowIso = new Date().toISOString();
      const m = {
        email, name: NAMES[lp] || email, balance: 0, dcBalance: 0, verified: false,
        role: ROLES[lp] || "Member", lastMinedAt: null, createdAt: nowIso, mineDay: "",
        freeMinesUsed: 0, freeGamesUsed: 0, paidTier: 0, paidRemaining: 0,
        graceUntil: null, banned: false, onboardedAt: null, arcadeOnboardedAt: null,
        dcSplitSeenAt: nowIso,
      };
      state.members.push(m); byE[email] = m; return m;
    };
    ensure(from); ensure(to);
    byE[to].balance = round2(byE[to].balance + cc);
    byE[from].balance = round2(byE[from].balance - cc);
    tx.set(ref, { json: JSON.stringify(state), updatedAt: new Date().toISOString() });
    return { seq, hash, fromBal: byE[from].balance, toBal: byE[to].balance, state };
  });

  let bdtPerCC = "?";
  try { bdtPerCC = await syncSheet(res.state); } catch (e) { console.error("⚠ sheet sync failed (ledger IS updated):", e.message); }

  console.log("✅ Recorded TRANSFER — seq " + res.seq + "  (" + bdt(createdAt) + " BDT)");
  console.log("   " + nm(from) + "  pays " + cc + " CC  →  " + nm(to) + "  (for " + food + ")");
  console.log("   " + nm(from) + ": " + res.fromBal + " CC   |   " + nm(to) + ": " + res.toBal + " CC");
  console.log("   sheet: " + res.seq + "\tTRANSFER\t" + nm(from) + "\t" + nm(to) + "\t" + cc + "\t" + memo + "\t" + bdt(createdAt) + "\t" + res.hash);
  console.log("   1 CC ≈ ৳" + bdtPerCC);
  process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
