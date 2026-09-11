# Claude Code Prompt — Build "Capsule Coin" Internal Marketplace Webapp

> Paste everything below into Claude Code.

---

## Your first task (do NOT write code yet)

Before scaffolding anything, produce a written **build plan + proposed architecture**, then **pause and confirm the items marked `Decision needed`** with me. Do not create the project until I approve the plan. Then build in phases with a checkpoint after each. Whenever a requirement is ambiguous, ask instead of guessing.

---

## What we're building

An internal web app for a closed 16-person group called **Capsule**. Members trade food items with each other using an internal currency, **Capsule Coin (CC)**, whose value floats on a supply/demand model. Access is restricted to verified members only. Every completed trade is written to a locked master ledger.

## Member allowlist — only these emails may register

```
fayjul.islam@orbitax.com      — Fayjul Islam
adnan.istiaque@orbitax.com    — Adnan Istiaque
ashap.bappy@orbitax.com       — Ashap Bappy
asish.pal@orbitax.com         — Asish Pal
enamul.hasan@orbitax.com      — Enamul Hasan
ishtiaq.samiul@orbitax.com    — Ishtiaq Samiul
mujahedul.azad@orbitax.com    — Md Mujahedul Azad (Turin)
amdadul.haque@orbitax.com     — Md. Amdadul Haque
jakir.hossen@orbitax.com      — Md. Jakir Hossen Shagor
mainul.ahsan@orbitax.com      — Md. Mainul Ahsan "Swaad"
masum.billah@orbitax.com      — Md. Masum Billah
nayeem.hossain@orbitax.com    — Nayeem Hossain
prottya.roy@orbitax.com       — Prottya Roy
riaz.khan@orbitax.com         — Riaz Khan
sabbir.hasan@orbitax.com      — Sabbir Hasan
shafi.kader@orbitax.com       — Shafi Al Kader (Sopan)
```

Store this allowlist server-side. Enforce it on the server — never in a way the client can bypass.

---

## Core features

### 1. Membership gate + email verification
- Registration succeeds only if the email is in the allowlist.
- Verify ownership by sending a one-time code/link to that address; the account is inactive until verified.
- **Decision needed:** I must supply an email-sending method. Confirm what to use (SMTP on orbitax.com, or an API such as Resend/SendGrid). Treat this as a hard dependency and read the key from an env var.

### 2. Wallet + balances
- Each member has a CC balance.
- A "see everyone's coins" overview/leaderboard listing every member's balance (and optionally holdings/net worth).
- **Decision needed:** are balances public to all members, or partially private?

### 3. Mining (coin issuance = increases supply)
- Members can mine CC into their balance.
- **Decision needed — proposed default:** a lightweight, rate-limited claim: a cooldown timer per claim, with reward that shrinks as total circulating supply grows (simulating rising difficulty). Confirm the exact cooldown, reward, and difficulty curve. Mining must be rate-limited and validated server-side.

### 4. Offers / marketplace
- A member posts an offer: a food item + the CC price (sell), or a buy request.
- Others browse and accept. On acceptance, CC transfers buyer → seller and the item is marked traded.
- Support: create, list/browse, accept, cancel. Food items only for now; keep the item model extensible (categories later).

### 5. Transactions + the locked ledger
- Every completed transaction updates a **locked master Excel workbook** that serves as the audit ledger and the human-readable record of balances + full history.
- **Architecture note (important):** a live Excel file is unsafe as the *concurrent* store for a multi-user app — write locks, corruption, and race conditions. **Recommended:** use a real transactional DB (SQLite to start, or Postgres) as the live store, and **auto-sync the locked Excel after every committed transaction** as the master ledger/export. The Excel stays password/structure-protected so it can't be casually edited and always reflects current balances + full transaction log.
- **Decision needed:** confirm you're OK with DB-as-live-store + Excel-as-synced-ledger. If you require Excel to be the literal live store, I'll instead implement a safe serialized single-writer queue with file locking (slower, less robust) — tell me which.

### 6. Coin value (supply/demand)
- CC value floats on a supply/demand ratio and is shown prominently with a trend.
- **Decision needed — define "value" precisely.** CC has no external fiat pair, so "value" is most likely a **scarcity/demand index**, not an exchange rate. Proposed default: `Index = k × (Demand ÷ Supply)`, where `Supply` = total CC in circulation and `Demand` = total CC locked in open buy offers + rolling transaction volume over the last N days. Propose the exact formula, inputs, update cadence, and the value of `k` and `N`, then confirm with me before implementing.

---

## Design / UI direction (high priority — avoid the generic look)

- **Do NOT** produce the default pale/white "AI-generated" aesthetic. This should look like a premium crypto exchange.
- **Mood:** dark, rich, high-value, with depth and subtle glow.
- **Palette:** deep charcoal/navy/black base + a signature **gold/amber "coin" accent**, plus one vibrant secondary (electric teal or violet) for highlights and CTAs.
- **Motif:** lean into the *capsule* idea — pill/capsule shapes for cards, buttons, and badges. Design a custom **coin logo** that fuses a capsule silhouette with a "C" monogram / coin edge. Ship it as SVG + a favicon.
- **Themed animated background:** subtle, not busy — floating coins/particles, a soft gradient mesh, or a faint market-grid glow.
- **Micro-interactions:** count-up animations on balances, shimmer/flip on the coin logo, a mining animation, hover glows on cards.
- **Typography:** modern geometric sans — e.g. Space Grotesk or Sora for display, Inter for body.
- **Icons:** use **Lucide** for UI icons and pick semantically correct ones (wallet, pickaxe = mining, trending-up = value, coins, shield-check = verified, etc.).
- Fully responsive (desktop + mobile).

---

## Tech

- **Decision needed — propose the stack.** Given auth + email + DB + Excel sync + a polished SPA, good fits are **Next.js full-stack (TypeScript)** or a **React frontend + Python FastAPI backend** (Python has strong Excel tooling via `openpyxl`/`pandas`). Recommend one with reasoning and let me pick.
- Excel: robust library with workbook protection (`openpyxl` for Python, `exceljs` for Node).
- Real DB for live state; all secrets in env vars.

## Security / integrity (non-negotiable for a currency)

- All balance/transaction mutations are **server-side and atomic**. Verify sufficient CC before transfer, inside a DB transaction — no double-spend, no negative balances.
- Handle offer race conditions (two buyers accepting the same offer — first commit wins, second fails cleanly).
- Enforce the allowlist and email verification server-side. Rate-limit mining and verification requests.
- Keep an append-only transaction log.

---

## Phases (checkpoint after each)

1. Plan + architecture doc + resolve all `Decision needed` items.
2. Scaffold + auth + email verification + allowlist gate.
3. Wallet, balances, leaderboard.
4. Offers/marketplace + atomic transaction engine.
5. Mining + supply/demand value engine.
6. Locked Excel ledger auto-sync.
7. UI polish pass to the design direction above.
8. `README` with setup, env vars, run instructions, and how the Excel sync works.

**Start now by giving me the plan and your questions — no code until I approve.**
