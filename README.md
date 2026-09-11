# Capsule Coin (CC)

A private, invite‑only marketplace where the 16‑person **Capsule** group trades
food using an internal floating currency — **CC**. Members mine CC, sell/buy food,
send peer‑to‑peer payments (with the payer's approval), and watch the coin's live
৳/$ value move with the group's balance spread. **Deployed free on Vercel + Firestore.**

- **Auth:** **Sign in with Google** (the member's @orbitax.com account) via Firebase
  Auth, gated by a 16‑email allowlist and cached per device (sign in once, stay in).
- **Ledger:** server‑owned, stored in **Cloud Firestore** as one transactional
  document; downloadable on demand as a protected **`.xlsx`** and mirrored
  **read‑only to a Google Sheet** for everyone to view.
- **Economy:** collision‑lottery mining, a spread‑based ৳/$ value, a −500 CC shared
  credit floor, and a fixed mining supply cap so CC can't inflate away.

---

## Tech stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind · Firebase Auth +
firebase‑admin · **Cloud Firestore** (the ledger) · exceljs (`.xlsx` export) ·
googleapis (Sheet mirror) · lucide‑react. **Hosted on Vercel.**

## Architecture

- **Frontend + API** — Next.js on **Vercel** (serverless functions, always‑on, free).
- **Source of truth** — the entire ledger lives in **one Firestore document**
  (`ledger/state`) as JSON. Every mutation runs inside a **Firestore transaction**
  (read → validate → write), which serializes concurrent writers with automatic
  retries — the same no‑double‑spend / SHA‑256 hash‑chain guarantee a single‑writer
  lock gives, but durable and correct across serverless instances.
- **Excel** — generated on demand from Firestore ("Download .xlsx"); never a stored
  file. **Google Sheet** — the server pushes the full state after every change (a
  read‑only, member‑facing mirror with visible history).
- **Why Firestore, not a file?** Vercel is serverless (ephemeral, read‑only
  filesystem), so a live `.xlsx` on disk can't work there. Firestore gives durable,
  transactional, always‑on storage on the free (Spark) tier — no card required.

---

## Prerequisites

- **Node.js 20+** and npm.
- A **Firebase project** (this repo is wired for `capsule-coin`) with a
  **service‑account JSON** (Project settings → Service accounts → Generate key).
- **Cloud Firestore enabled** (Build → Firestore Database → Create) — free Spark tier.
- **Google sign‑in enabled** (Authentication → Sign‑in method → Google) with its
  **OAuth consent screen published**.
- A **Vercel account** (free Hobby) for hosting.
- *(Optional)* a **Google Sheet** + the **Google Sheets API** enabled, for the mirror.

---

## 1. Install

```bash
npm install
```

## 2. Environment variables

These are set **locally** in `.env.local` and **on Vercel** (Project → Settings →
Environment Variables). `NEXT_PUBLIC_*` are inlined at build time.

```bash
# ── Firebase web config (public — safe in the client, needed at BUILD time) ──
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=capsule-coin.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=capsule-coin
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=capsule-coin.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=...

# ── Firebase Admin (SERVER‑ONLY secret) — verifies tokens + Firestore + Sheets ──
# On Vercel: paste the WHOLE service‑account JSON here (one variable).
FIREBASE_ADMIN_SERVICE_ACCOUNT=
# Local only (alternative to the above): path to the JSON file (gitignored).
FIREBASE_ADMIN_CREDENTIALS_FILE=./capsule-coin-firebase-adminsdk-xxxx.json

# ── Ledger ──────────────────────────────────────────────────────────────────
SEED_TOKEN=change-me-seed-token   # gates /api/seed and the manual sheet re‑sync
LEDGER_XLSX_PASSWORD=change-me     # protects the exported / mirrored .xlsx sheets
LEDGER_DOC_ID=state               # optional — Firestore doc id; use another value
                                  # for an isolated test/staging ledger

# ── Google Sheet mirror (read‑only, member‑facing) ──────────────────────────
GOOGLE_SHEETS_ID=<your sheet id>  # empty = mirror disabled
NEXT_PUBLIC_GOOGLE_SHEET_URL=https://docs.google.com/spreadsheets/d/<id>/edit

# ── Economy (all optional — sensible defaults live in lib/config.ts) ─────────
MINING_KEYSPACE_FREE=13000000000  # bigger = fewer matches = leaner free mining
MINING_KEYSPACE_TIER1=1500000000
MINING_KEYSPACE_TIER2=1300000000
MINING_KEYSPACE_TIER3=1000000000
MINING_REWARD_CAP=10
MINING_FREE_PER_DAY=3
MINING_SUPPLY_CAP=5000            # max NET CC mining can ever add to circulation
CC_BDT_MIN=0.5
CC_BDT_MAX=10
CC_SPREAD_SCALE=180
CC_VALUE_POWER=0.5                # √ of the raw band; 1 = off
USD_BDT_RATE=120
BALANCE_FLOOR=-500
RATE_LIMIT_MAX=10                 # create‑requests per 60s before a temp block
```

> **Not used with Firestore:** `LEDGER_XLSX_PATH` and `LEDGER_BACKUP_COUNT` were for
> the old on‑disk Excel store — leave them unset. On Vercel do **not** set
> `FIREBASE_ADMIN_CREDENTIALS_FILE` (there's no file); use `FIREBASE_ADMIN_SERVICE_ACCOUNT`.

The **member allowlist** (the 16 emails + names/roles) lives in `lib/allowlist.ts`,
not in env — edit it there to change membership.

## 3. Firebase + Firestore setup

1. **Service account** — put the JSON where `FIREBASE_ADMIN_CREDENTIALS_FILE` points
   (local), or paste it into `FIREBASE_ADMIN_SERVICE_ACCOUNT` (Vercel).
2. **Enable Cloud Firestore** — Firebase Console → **Build → Firestore Database →
   Create database → Production mode** (only the server writes, via the Admin SDK)
   → pick a region (e.g. `asia-south1`). Free Spark tier; no card.
3. **Enable Google sign‑in** — Authentication → Sign‑in method → **Google → Enable**
   (pick a support email). Then open the **OAuth consent screen** (Google Cloud →
   APIs & Services → OAuth consent screen → Audience) and **Publish app**.
4. **Authorized domains** — Authentication → **Settings → Authorized domains** → add
   your Vercel domain (e.g. `capsule-coin.vercel.app`); `localhost` is already there.

The 16‑email allowlist in `lib/allowlist.ts` is the real gate: any Google account
outside it — including other @orbitax.com colleagues — gets a "Not a Capsule
member" screen.

## 4. Google Sheet mirror (optional)

1. **Enable the Google Sheets API** in the service account's GCP project.
2. **Share the sheet** as **Editor** with the service‑account email
   (`...@<project>.iam.gserviceaccount.com`).
3. **General access → Anyone with the link → Viewer** (or add members as Viewers).
4. Set `GOOGLE_SHEETS_ID` + `NEXT_PUBLIC_GOOGLE_SHEET_URL`.

The server rewrites **Value / Members / Transactions / Requests** tabs after every
change. Force a manual re‑push:

```bash
curl -X POST "https://<your-app>.vercel.app/api/sheets/sync" -H "x-seed-token: <SEED_TOKEN>"
```

## 5. Deploy to Vercel

From the project folder (no GitHub needed — the CLI deploys the local dir):

```bash
npm i -g vercel
vercel            # first run: create the project (name it "capsule-coin")
```

Then add every variable from step 2 in **Project → Settings → Environment
Variables** (all environments), and ship it:

```bash
vercel --prod
```

You'll get `https://capsule-coin.vercel.app`. Add that domain to Firebase
Authorized domains (step 3.4). Every later `vercel --prod` redeploys.

## 6. Seed the ledger (once)

Builds the ledger in Firestore from `lib/seed.ts` (opening balances + full manual
history + real in‑app trades) so balances reconcile exactly, and syncs the Sheet.
`?rebuild=1` wipes and rebuilds; without it the import is idempotent (no‑op once
transactions exist).

```bash
curl -X POST "https://capsule-coin.vercel.app/api/seed?rebuild=1" -H "x-seed-token: <SEED_TOKEN>"
```

## Local development

```bash
npm run dev          # http://localhost:3000 (talks to the same Firestore)
```

Point local runs at an **isolated** ledger with `LEDGER_DOC_ID=capsule_test` (and
`GOOGLE_SHEETS_ID=` empty) so testing never touches the live `state` document.

---

## How it works

### The ledger — Firestore is the source of truth
The whole `LedgerState` (members, offers, transactions, transfers) is stored as JSON
in a single Firestore document. Every change runs through `mutate()` = a Firestore
`runTransaction` (read → apply → write), so concurrent writers are serialized (with
auto‑retry) — no double‑spend, and every transaction is **append‑only + SHA‑256
hash‑chained**. The **`.xlsx` download** and the **Google Sheet** are generated from
this state (views, never the source). Both are reachable from the Ledger page.

### Auth — Sign in with Google, verify once per device
Members click **Continue with Google** and pick their **@orbitax.com** account;
Firebase returns an ID token the server verifies on every request and checks against
the 16‑email allowlist. The session is cached per device — "Sign out" is a **soft
lock** (device stays trusted → one‑tap "Continue"); "Sign out completely" fully
de‑authenticates. **Joined** counts members who've actually signed in.

### Marketplace
- **Offers** — post a SELL ("Samosa · 15 CC") or a BUY (escrows your CC); someone
  Accepts to settle instantly.
- **Transfers** — **Request CC** (payee asks; the **payer must approve/decline**;
  requester can cancel) or **Send CC** (payer pays directly). Pending requests are
  public, and the payer gets a nav badge.

### Economy
- **Mining** — each mine draws 100,000 tokens against a hidden set; every collision
  pays U(0.1–1.0) CC, capped at `MINING_REWARD_CAP`. **3 free mines/day**, then a
  pay‑to‑mine ladder (20/50/100 CC → 5/10/20 mines) that gets richer per tier. Fees
  are **burned**; a fixed **supply cap** (net mined − burned) means CC can't inflate.
- **Value** — 1 CC in ৳/$ rises with the **standard deviation** of member balances,
  bounded and root‑compressed into a calm range, recomputed live after every change.
- **Balance floor** — members may go negative down to **−500 CC** (a shared credit
  line); anything that would breach it is blocked, and balances at/below −400 show a
  "near bankrupt" flag + wallet alert.

---

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Dev server on `localhost:3000` |
| `npm run build` | Production build |
| `npm run start` | Serve a production build (`next start`, honours `$PORT`) |
| `npm run start:cloud` | `next start -H 0.0.0.0` (bind all interfaces, honours `$PORT`) |
| `npm run lint` | Lint |
| `npm run dev:lan` / `start:lan` / `serve:lan` | Legacy LAN serving on `0.0.0.0:2770` |

## Security notes

- Never commit the service‑account JSON or `.env.local` (both are gitignored).
- All data routes verify the Firebase ID token **and** the allowlist server‑side.
- Sign‑in is **Google (Firebase Auth)**; the allowlist — not the domain — decides
  who gets in.
- Firestore has **no client access** — only the server (Admin SDK) reads/writes it,
  so leaving rules in production ("locked") mode is correct.
- `SEED_TOKEN` gates `/api/seed` and the manual sheet re‑sync — keep it secret.
- Create‑requests are rate‑limited per member to blunt bot spam. *(Note: on
  serverless the limiter is per‑instance; fine for a small group, swap for a shared
  store if you ever need strict global limits.)*
