#!/usr/bin/env node
/*
 * Seed the arcade game pools (Firestore) from scripts/game-seed/*.json.
 *
 *   node scripts/seed-game-pools.cjs                      # dry run (default)
 *   node scripts/seed-game-pools.cjs --commit             # write to Firestore
 *   node scripts/seed-game-pools.cjs --commit --replace   # overwrite instead of merge
 *   node scripts/seed-game-pools.cjs --doc capsule_test --commit   # isolated test pools
 *
 * Flags:
 *   --commit         actually write (default is a dry run that writes nothing)
 *   --replace        overwrite each doc (default MERGES new items, de-duplicated)
 *   --doc <id>       namespace, matching lib/games/common.ts: "state" (default) →
 *                    plain collections; anything else → "<id>__wordPool" etc.
 *
 * Collections written:
 *   wordPool/len5, wordPool/len6           = { words: string[] }   (consumed once)
 *   paragraphPool/d1 .. d5                 = { paragraphs: [{id,text}] } (reused)
 *   problemPool/<topic>                    = { problems: [{id,title,statement,difficulty}] } (consumed once)
 *   mcqPool/all                            = { questions: [{id,question,options,answer,topic}] } (consumed once)
 *
 * NOTE: merge does not track words consumed in past sessions, so re-seeding the
 * SAME list can reintroduce a previously-used word. For a strict used-once corpus
 * across re-seeds, seed fresh words (or --replace onto an empty pool).
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
const REPLACE = flag("replace");

// Must match lib/games/common.ts namespacing.
const NS = DOC === "state" ? "" : `${DOC}__`;
const WORD_POOL = `${NS}wordPool`;
const PARAGRAPH_POOL = `${NS}paragraphPool`;
const PROBLEM_POOL = `${NS}problemPool`;
const MCQ_POOL = `${NS}mcqPool`;

const words = JSON.parse(fs.readFileSync(path.join(__dirname, "game-seed", "words.json"), "utf8"));
const paras = JSON.parse(fs.readFileSync(path.join(__dirname, "game-seed", "paragraphs.json"), "utf8"));
const problems = JSON.parse(fs.readFileSync(path.join(__dirname, "game-seed", "problems.json"), "utf8"));
const mcqs = JSON.parse(fs.readFileSync(path.join(__dirname, "game-seed", "mcqs.json"), "utf8"));
const pid = (text) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);

async function seedWords() {
  const report = [];
  for (const len of Object.keys(words)) {
    const incoming = [...new Set(words[len].map((w) => String(w).trim().toLowerCase()))].filter(
      (w) => w.length === Number(len),
    );
    const ref = db.collection(WORD_POOL).doc(`len${len}`);
    const snap = await ref.get();
    const existing = snap.exists && Array.isArray(snap.data().words) ? snap.data().words : [];
    const merged = REPLACE ? incoming : [...new Set([...existing, ...incoming])];
    report.push({ doc: `${WORD_POOL}/len${len}`, existing: existing.length, incoming: incoming.length, after: merged.length });
    if (COMMIT) await ref.set({ words: merged }, { merge: false });
  }
  return report;
}

async function seedParagraphs() {
  const report = [];
  for (const d of Object.keys(paras)) {
    const incoming = paras[d]
      .map((t) => String(t).trim())
      .filter((t) => t.length > 0)
      .map((text) => ({ id: pid(text), text }));
    const ref = db.collection(PARAGRAPH_POOL).doc(`d${d}`);
    const snap = await ref.get();
    const existing = snap.exists && Array.isArray(snap.data().paragraphs) ? snap.data().paragraphs : [];
    let merged;
    if (REPLACE) {
      merged = incoming;
    } else {
      const seen = new Set(existing.map((p) => p.id));
      merged = [...existing, ...incoming.filter((p) => !seen.has(p.id))];
    }
    report.push({ doc: `${PARAGRAPH_POOL}/d${d}`, existing: existing.length, incoming: incoming.length, after: merged.length });
    if (COMMIT) await ref.set({ paragraphs: merged }, { merge: false });
  }
  return report;
}

async function seedProblems() {
  const report = [];
  for (const topic of Object.keys(problems)) {
    const incoming = problems[topic]
      .filter((p) => p && typeof p.statement === "string" && p.statement.trim().length > 0)
      .map((p) => ({
        id: pid(p.statement),
        title: String(p.title || "Problem"),
        statement: String(p.statement),
        difficulty: Number(p.difficulty) || 1,
      }));
    const ref = db.collection(PROBLEM_POOL).doc(topic);
    const snap = await ref.get();
    const existing = snap.exists && Array.isArray(snap.data().problems) ? snap.data().problems : [];
    let merged;
    if (REPLACE) {
      merged = incoming;
    } else {
      const seen = new Set(existing.map((p) => p.id));
      merged = [...existing, ...incoming.filter((p) => !seen.has(p.id))];
    }
    report.push({ doc: `${PROBLEM_POOL}/${topic}`, existing: existing.length, incoming: incoming.length, after: merged.length });
    if (COMMIT) await ref.set({ problems: merged }, { merge: false });
  }
  return report;
}

async function seedMcqs() {
  const incoming = mcqs
    .filter(
      (q) =>
        q &&
        typeof q.question === "string" &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        Number.isInteger(q.answer) &&
        q.answer >= 0 &&
        q.answer < q.options.length,
    )
    .map((q) => ({
      id: pid(q.question),
      question: String(q.question),
      options: q.options.map((o) => String(o)),
      answer: Number(q.answer),
      topic: String(q.topic || "ai"),
      ...(q.explanation ? { explanation: String(q.explanation) } : {}),
    }));
  const ref = db.collection(MCQ_POOL).doc("all");
  const snap = await ref.get();
  const existing = snap.exists && Array.isArray(snap.data().questions) ? snap.data().questions : [];
  let merged;
  if (REPLACE) {
    merged = incoming;
  } else {
    const seen = new Set(existing.map((q) => q.id));
    merged = [...existing, ...incoming.filter((q) => !seen.has(q.id))];
  }
  const report = [{ doc: `${MCQ_POOL}/all`, existing: existing.length, incoming: incoming.length, after: merged.length }];
  if (COMMIT) await ref.set({ questions: merged }, { merge: false });
  return report;
}

(async () => {
  console.log(`Seeding game pools → doc namespace "${DOC}" (${NS || "prod/plain"})`);
  console.log(`Mode: ${COMMIT ? (REPLACE ? "COMMIT + REPLACE" : "COMMIT + MERGE") : "DRY RUN (no writes)"}\n`);

  const w = await seedWords();
  const p = await seedParagraphs();
  const pr = await seedProblems();
  const mc = await seedMcqs();

  console.log("Words:");
  w.forEach((r) => console.log(`  ${r.doc}: existing ${r.existing} + incoming ${r.incoming} -> ${r.after}`));
  console.log("Paragraphs:");
  p.forEach((r) => console.log(`  ${r.doc}: existing ${r.existing} + incoming ${r.incoming} -> ${r.after}`));
  console.log("Problems:");
  pr.forEach((r) => console.log(`  ${r.doc}: existing ${r.existing} + incoming ${r.incoming} -> ${r.after}`));
  console.log("MCQs:");
  mc.forEach((r) => console.log(`  ${r.doc}: existing ${r.existing} + incoming ${r.incoming} -> ${r.after}`));

  const totalWords = w.reduce((a, r) => a + r.after, 0);
  const totalParas = p.reduce((a, r) => a + r.after, 0);
  const totalProblems = pr.reduce((a, r) => a + r.after, 0);
  const totalMcqs = mc.reduce((a, r) => a + r.after, 0);
  console.log(
    `\nAfter seed: ${totalWords} words, ${totalParas} paragraphs, ${totalProblems} problems, ${totalMcqs} MCQs${
      COMMIT ? " (written)" : " (dry run — nothing written)"
    }.`,
  );
  if (!COMMIT) console.log("Re-run with --commit to write.");
  process.exit(0);
})().catch((e) => { console.error("ERR:", (e && e.stack) || e); process.exit(1); });
