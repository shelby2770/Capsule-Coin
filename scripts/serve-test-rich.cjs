// Local-only "rich" test server for hands-on UI testing.
//
//   1) Tops up a test account's CC to an effectively-infinite balance in the
//      ISOLATED `capsule_test` Firestore ledger (NEVER production), and clears any
//      ban / credit-floor grace + hands back today's free play, so the account can
//      always play every tier.
//   2) Runs `next dev` on port 2771 against that same isolated doc, with Google
//      Sheet sync disabled — exactly like scripts/serve-test.cjs.
//
// Balances are stored-and-trusted in the ledger (the SHA-256 hash chain only
// covers the transaction log, not member balances), so setting the balance
// directly is safe: it survives reloads and every later game action just spends
// against it. Nothing here touches the transaction chain.
//
// Usage:
//   node scripts/serve-test-rich.cjs
//   node scripts/serve-test-rich.cjs --email you@orbitax.com --amount 1000000000
//   node scripts/serve-test-rich.cjs --fresh   # ALSO wipe this account's game
//                                              # sessions, resetting the per-tier
//                                              # "one paid play per day" limits and
//                                              # any resumable game
//   node scripts/serve-test-rich.cjs --no-serve  # just top up (a server is already
//                                                # running); don't start another one
//
// Admin credentials are resolved like the app (lib/firebase/admin.ts):
//   FIREBASE_ADMIN_CREDENTIALS_FILE  -> path to the service-account JSON, else
//   FIREBASE_ADMIN_SERVICE_ACCOUNT   -> inline JSON, else
//   ./capsule-coin-firebase-adminsdk-fbsvc-fea87c9661.json (the local dev key), else
//   GOOGLE_APPLICATION_CREDENTIALS   -> application default credentials.
//
// NOTE: a giant single balance makes the cosmetic "1 CC = ৳…" value read pin to
// its max (the fiat rate keys off the spread of member balances). That's display
// only and isolated to capsule_test.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const admin = require("firebase-admin");

const PROJECT = path.join(__dirname, "..");
const DOC_ID = "capsule_test";
const SESSIONS_COLLECTION = `${DOC_ID}__gameSessions`;
const DEFAULT_EMAIL = "adnan.istiaque@orbitax.com";
const DEFAULT_AMOUNT = 1_000_000_000; // 1e9 CC — effectively infinite for testing

function parseArgs(argv) {
  const out = { email: DEFAULT_EMAIL, amount: DEFAULT_AMOUNT, fresh: false, serve: true };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fresh") out.fresh = true;
    else if (a === "--no-serve") out.serve = false;
    else if (a === "--email") out.email = argv[++i];
    else if (a.startsWith("--email=")) out.email = a.slice("--email=".length);
    else if (a === "--amount") out.amount = Number(argv[++i]);
    else if (a.startsWith("--amount=")) out.amount = Number(a.slice("--amount=".length));
    else positional.push(a);
  }
  if (positional[0]) out.email = positional[0];
  if (positional[1] !== undefined) out.amount = Number(positional[1]);
  out.email = String(out.email).trim().toLowerCase();
  if (!Number.isFinite(out.amount) || out.amount <= 0) out.amount = DEFAULT_AMOUNT;
  return out;
}

function loadServiceAccount() {
  const file = process.env.FIREBASE_ADMIN_CREDENTIALS_FILE;
  if (file && file.trim()) {
    try {
      return JSON.parse(fs.readFileSync(path.resolve(PROJECT, file.trim()), "utf8"));
    } catch (e) {
      console.error("[rich] FIREBASE_ADMIN_CREDENTIALS_FILE unreadable:", e.message);
    }
  }
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (raw && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error("[rich] FIREBASE_ADMIN_SERVICE_ACCOUNT unparseable:", e.message);
    }
  }
  const fallback = path.join(PROJECT, "capsule-coin-firebase-adminsdk-fbsvc-fea87c9661.json");
  if (fs.existsSync(fallback)) {
    try {
      return JSON.parse(fs.readFileSync(fallback, "utf8"));
    } catch (e) {
      console.error("[rich] local service-account key unreadable:", e.message);
    }
  }
  return null;
}

function initAdmin() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "capsule-coin";
  const svc = loadServiceAccount();
  if (svc) return admin.initializeApp({ credential: admin.credential.cert(svc), projectId });
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
  }
  throw new Error(
    "No admin credentials found. Set FIREBASE_ADMIN_CREDENTIALS_FILE, or keep the " +
      "service-account JSON (capsule-coin-firebase-adminsdk-fbsvc-*.json) in the project root.",
  );
}

function emptyState() {
  return { members: [], offers: [], transactions: [], transfers: [], negotiations: [], fruitFundBdt: 0 };
}

async function topUp(db, email, amount) {
  const ref = db.collection("ledger").doc(DOC_ID);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = snap.exists && snap.data().json ? JSON.parse(snap.data().json) : emptyState();
    if (!Array.isArray(state.members)) state.members = [];
    let m = state.members.find((x) => String(x.email || "").toLowerCase() === email);
    if (!m) {
      m = {
        email,
        name: email,
        balance: 0,
        dcBalance: 0,
        verified: true,
        role: "Member",
        lastMinedAt: null,
        createdAt: new Date().toISOString(),
        mineDay: "",
        freeMinesUsed: 0,
        paidTier: 0,
        paidRemaining: 0,
        graceUntil: null,
        banned: false,
        onboardedAt: new Date().toISOString(),
      };
      state.members.push(m);
    }
    m.balance = amount; // effectively infinite CC
    m.verified = true;
    m.banned = false; // never locked out mid-test
    m.graceUntil = null;
    m.freeMinesUsed = 0; // hand back today's shared free play too
    tx.set(ref, { json: JSON.stringify(state), updatedAt: new Date().toISOString() });
  });
}

async function clearSessions(db, email) {
  const q = await db.collection(SESSIONS_COLLECTION).where("email", "==", email).get();
  if (q.empty) return 0;
  const batch = db.batch();
  q.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return q.size;
}

function serve() {
  const env = {
    ...process.env,
    LEDGER_DOC_ID: DOC_ID,
    GOOGLE_SHEETS_ID: "none", // invalid but non-empty -> sheet writes fail harmlessly
    // Match the post-migration DC supply so DC->CC convert quotes read realistically.
    DC_REF_SUPPLY: process.env.DC_REF_SUPPLY || "906",
  };
  console.log("[rich] starting test server -> http://localhost:2771  (LEDGER_DOC_ID=capsule_test)\n");
  const p = spawn("npx", ["next", "dev", "-p", "2771"], {
    stdio: "inherit",
    cwd: PROJECT,
    env,
    shell: true, // Windows: resolve npx.cmd through the shell
  });
  p.on("exit", (c) => process.exit(c ?? 0));
}

(async () => {
  const { email, amount, fresh, serve: doServe } = parseArgs(process.argv.slice(2));
  try {
    initAdmin();
    const db = admin.firestore();
    await topUp(db, email, amount);
    console.log(
      `[rich] ${email} -> ${amount.toLocaleString()} CC in ledger/${DOC_ID} (ban/grace cleared, free play reset)`,
    );
    if (fresh) {
      const n = await clearSessions(db, email);
      console.log(`[rich] --fresh: cleared ${n} game session(s) (per-tier daily limits reset)`);
    }
  } catch (e) {
    console.error("[rich] top-up failed:", e.message);
    process.exit(1);
  }
  if (doServe) serve();
  else {
    console.log("[rich] --no-serve: done (existing server keeps running; its cached balance refreshes shortly).");
    process.exit(0);
  }
})();
