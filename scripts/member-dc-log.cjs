#!/usr/bin/env node
/*
 * READ-ONLY. Dump every ledger transaction for one member, windowed from the
 * INVENTION OF DC (the earliest DC-currency tx in the whole ledger) through the
 * member's LAST DC->CC CONVERSION (their latest CONVERT row). Chronological, with
 * a running CC and DC balance on each row. Never writes.
 *
 *   node scripts/member-dc-log.cjs --name Shafi
 *   node scripts/member-dc-log.cjs --email shafi.kader@orbitax.com
 *   node scripts/member-dc-log.cjs --name Shafi --csv data/shafi-dc-log.csv
 *   node scripts/member-dc-log.cjs --name Shafi --from 120 --to 780   # override window by seq
 *   node scripts/member-dc-log.cjs --name Shafi --doc capsule_test
 *
 * Flags:
 *   --email <addr> | --name <text>   pick the member (name must match exactly one)
 *   --csv <path>    also write the log to a CSV file (memos quoted/escaped)
 *   --from <seq>    override window start (default = earliest DC-currency tx, global)
 *   --to <seq>      override window end   (default = member's last CONVERT row)
 *   --doc <id>      ledger doc id (default "state"; e.g. "capsule_test")
 *
 * Running balances accumulate over ALL the member's history in seq order, so the
 * balance shown on the first windowed row already reflects their pre-DC CC. Effect
 * per row: +amount if credited (toEmail), -amount if debited (fromEmail), applied to
 * CC (currency CC -> balance) or DC (currency DC -> dcBalance). Times are UTC.
 */
const fs = require("fs");
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
const CSV = opt("csv");
const FROM = opt("from") != null ? Number(opt("from")) : null;
const TO = opt("to") != null ? Number(opt("to")) : null;
const r2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;
const cur = (t) => t.currency || "CC";
const dt = (s) => String(s || "").replace("T", " ").replace(/\..*$/, "").replace("Z", "");

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
  if (!member) throw new Error("Member not found.");
  const email = member.email;
  const to = (t) => t.toEmail === email;
  const from = (t) => t.fromEmail === email;

  // window: [first DC-currency tx globally]  ..  [member's last CONVERT row]
  const firstDc = txs.find((t) => cur(t) === "DC");
  const memberConverts = txs.filter((t) => t.type === "CONVERT" && (to(t) || from(t)));
  const lastConv = memberConverts.length ? memberConverts[memberConverts.length - 1] : null;
  const startSeq = FROM != null ? FROM : (firstDc ? firstDc.seq : 1);
  const endSeq = TO != null ? TO : (lastConv ? lastConv.seq : (txs.length ? txs[txs.length - 1].seq : 0));

  console.log(`\nMember: ${member.name} <${email}>`);
  console.log(`Ledger: ${DOC}   current balances: ${r2(member.balance)} CC · ${r2(member.dcBalance)} DC`);
  console.log(`Window: seq ${startSeq} .. ${endSeq}`);
  console.log(`   from  ${firstDc ? `DC invented @ ${dt(firstDc.createdAt)} UTC (seq ${firstDc.seq})` : "start of ledger"}`);
  console.log(`   to    ${lastConv ? `last DC↔CC conversion @ ${dt(lastConv.createdAt)} UTC (seq ${lastConv.seq})` : "end of ledger"}${TO != null || FROM != null ? "  [overridden]" : ""}\n`);

  // walk ALL member txs in order for accurate running balances; print those in-window
  const header = ["seq", "datetime (UTC)", "type", "cur", "dir", "amount", "CC bal", "DC bal", "memo"];
  const rows = [];
  let ccBal = 0, dcBal = 0;
  for (const t of txs) {
    const inv = to(t), outv = from(t);
    if (!inv && !outv) continue; // not this member's row
    const amt = Number(t.amountCC || 0);
    const delta = (inv ? amt : 0) - (outv ? amt : 0);
    if (cur(t) === "DC") dcBal = r2(dcBal + delta); else ccBal = r2(ccBal + delta);
    if (t.seq < startSeq || t.seq > endSeq) continue;
    rows.push({
      seq: t.seq, datetime: dt(t.createdAt), type: t.type, cur: cur(t),
      dir: inv && outv ? "self" : inv ? "IN" : "OUT",
      amount: `${delta >= 0 ? "+" : ""}${r2(delta)}`, cc: ccBal, dc: dcBal, memo: t.memo || "",
    });
  }

  // console table
  const w = { seq: 5, datetime: 19, type: 9, cur: 3, dir: 4, amount: 10, cc: 9, dc: 9 };
  const pad = (s, n) => String(s).padEnd(n);
  const padS = (s, n) => String(s).padStart(n);
  console.log(`${pad(header[0], w.seq)} ${pad(header[1], w.datetime)} ${pad(header[2], w.type)} ${pad(header[3], w.cur)} ${pad(header[4], w.dir)} ${padS(header[5], w.amount)} ${padS(header[6], w.cc)} ${padS(header[7], w.dc)}  ${header[8]}`);
  console.log("─".repeat(84));
  for (const r of rows) {
    console.log(`${pad(r.seq, w.seq)} ${pad(r.datetime, w.datetime)} ${pad(r.type, w.type)} ${pad(r.cur, w.cur)} ${pad(r.dir, w.dir)} ${padS(r.amount, w.amount)} ${padS(r.cc, w.cc)} ${padS(r.dc, w.dc)}  ${r.memo}`);
  }
  console.log(`\n${rows.length} transaction(s) in window.`);

  // footer: net by currency within the window
  const netCC = r2(rows.filter((r) => r.cur === "CC").reduce((a, r) => a + Number(r.amount), 0));
  const netDC = r2(rows.filter((r) => r.cur === "DC").reduce((a, r) => a + Number(r.amount), 0));
  console.log(`Net within window:  CC ${netCC >= 0 ? "+" : ""}${netCC}   DC ${netDC >= 0 ? "+" : ""}${netDC}`);

  if (CSV) {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [header.join(",")];
    for (const r of rows) lines.push([r.seq, r.datetime, r.type, r.cur, r.dir, r.amount, r.cc, r.dc, esc(r.memo)].join(","));
    const outPath = path.isAbsolute(CSV) ? CSV : path.join(ROOT, CSV);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, lines.join("\n"));
    console.log(`\nCSV written: ${outPath}`);
  }
  console.log("");
})().catch((e) => { console.error("ERR:", (e && e.stack) || e); process.exit(1); });
