# DesertHouse → Capsule Coin routing (Google-side + app)

The DesertHouse Chat space is watched by a Google Workspace Studio Flow. Two
Gemini steps decide what happened, then a webhook POSTs the result to the app,
which settles it on the ledger (and mirrors to the Google Sheet).

Three things can be recorded:

1. **Food trade → CC.** Food/drink bought or sold between two members, priced in CC.
2. **Non-food trade → DC.** Anything not edible (gadgets, gifts, services, lending),
   priced in DC. The buyer must actually hold the DC (no credit line for DC).
3. **Taka → DC purchase (Fruit Fund).** Real money paid into the Capsule Fruit
   Fund in exchange for DC. **Only the Fruit Minister (Jakir) may report this.**

**Currency is tied to the item type — this is strict.** Food may ONLY be CC;
non-food may ONLY be DC. A message that pairs the wrong coin with the item (a
burger "for 10 DC", earbuds "for 20 CC") is rejected at step 2 (Gemini answers
`no`) and never reaches the app.

---

## App side (implemented)

`POST /api/desert-house/trade` — one endpoint, two payload shapes. Auth is the
static `DESERT_HOUSE_TOKEN` (in the JSON body as `{"token": "..."}`, since the
Studio webhook step has no custom headers; `Authorization: Bearer <token>` also
works for curl). `?format=text` returns just the one-line reply for the Flow's
"post a message" step. Every write is idempotent on `messageId` (a re-fired flow
never double-charges).

### Trade payload (kinds 1 & 2)

```json
{
  "token": "<DESERT_HOUSE_TOKEN>",
  "authorEmail": "buyer-or-seller@orbitax.com",
  "messageId": "<chat message id>",
  "gem": {
    "type": "trade",
    "isTrade": true,
    "sellerEmail": "seller@orbitax.com",
    "buyerEmail": "buyer@orbitax.com",
    "item": "Earbuds",
    "amountCC": 20,
    "currency": "DC"
  }
}
```

`amountCC` is the amount in the trade's `currency` (CC for food, DC for non-food).
`currency` is preferred; an `isFood: true|false` boolean is also accepted (true→CC,
false→DC); the safe default is CC. One of seller/buyer must equal `authorEmail`.

### Purchase payload (kind 3 — Fruit Fund top-up)

```json
{
  "token": "<DESERT_HOUSE_TOKEN>",
  "authorEmail": "jakir.hossen@orbitax.com",
  "messageId": "<chat message id>",
  "gem": {
    "type": "purchase",
    "isTrade": true,
    "buyerEmail": "riaz.khan@orbitax.com",
    "amountBdt": 500,
    "reason": "Eid"
  }
}
```

- The app credits the buyer's **DC computed from the taka** (the stable buy curve:
  ৳100 → ~113 DC, bigger buys earn a bounded bonus — ৳500 → ~682 DC) and adds the
  **taka to the Fruit Fund**. Gemini must NOT compute DC; the app does.
- **`authorEmail` must be the Fruit Minister** (`jakir.hossen@orbitax.com`). The
  app enforces this against the *trusted Chat author* (not the message text), so
  it can't be spoofed. Non-Minister → rejected (`NOT_PARTICIPANT`).
- `reason` is free text (optional). Amount is capped by `DESERT_HOUSE_MAX_BDT`.

The endpoint auto-detects a purchase from `type: "purchase"` or the presence of
`amountBdt`; otherwise it's treated as a trade.

---

## Gemini side (what to paste into the two Studio steps)

Step 2 (the gate) needs only MESSAGE_TEXT. Step 3 (the extractor) needs
MESSAGE_TEXT + AUTHOR_EMAIL (as it already does) — the Fruit-Minister check for
taka purchases lives in step 3, and the app re-checks it against the trusted Chat
sender, so it can't be spoofed.

> **⚠️ Trigger gating:** if your Studio Flow trigger only fires on messages
> containing **"cc"**, it will MISS DC trades and taka top-ups. Broaden the
> trigger's "Message has" to also match **dc**, **taka**, **tk**, **fund** (or
> drop the filter), or those messages never reach Gemini.

### Step 2 — the yes/no gate

```
You are the first gate for the Capsule Coin ledger. Decide whether the message
reports ONE recordable event of the kinds below. Reply with exactly one
lowercase word — yes or no — nothing else. No punctuation, no explanation.

MESSAGE_TEXT: the chat message.

Two coins, tied to what was traded:
- CC (also "cc", "coin", "Capsule Coin") is for FOOD only — meals, snacks,
  drinks, tea/coffee, groceries, restaurant orders, anything edible.
- DC (also "dc", "Dark Capsule Coin") is for NON-FOOD only — gadgets,
  accessories, clothes, books, tickets, services, lending, gifts, anything
  not edible.

Say YES for exactly one of these, fully completed:
1. A finished FOOD sale/purchase priced in CC.
   • "sold burger to @X for 10 CC"   • "bought pizza from Riaz bhai for 40 cc" 
2. A finished NON-FOOD sale/purchase priced in DC.
   • "sold earbuds to @X for 20 DC"  • "got the phone case from Nayeem for 8 dc"
3. A real-money payment INTO THE FRUIT FUND (taka / tk / ৳):
   • "Riaz paid 500 taka to fruit fund for Eid"
   • "Amdad gave 200 tk to the fund"
   (Whether the sender is allowed to report this is checked in the next step —
    answer yes here for any fruit-fund top-up.)

Say NO for anything else, including:
• CURRENCY MISMATCH — food priced in DC, or non-food priced in CC
  ("sold burger for 10 DC" → no; "sold earbuds for 20 CC" → no).
• real money (taka) paid to a PERSON, not the fruit fund
  ("paid Riaz 100tk for the burger" → no; real-money food isn't recorded).
• ads or listings ("selling burgers, 10 CC each")
• price questions ("how much for the pizza?")
• open offers / auctions still running ("starting bid 5 CC")
• general chat with no transaction.

Honorifics (bhai, vai), @mentions and nicknames are normal names.
Reply with exactly one lowercase word — yes or no.
```

### Step 3 — the extractor

```
You extract ONE ledger event from a DesertHouse chat message. Step 2 already
confirmed it is recordable — output the structured JSON only, no prose.

INPUT:
- MESSAGE_TEXT: the chat message
- AUTHOR_EMAIL: the sender's email (trusted; the author is always one party)

ROSTER — the only 16 people (name/nickname → email):
Adnan Istiaque (Adnan) → adnan.istiaque@orbitax.com
Ashap Bappy (Bappy) → ashap.bappy@orbitax.com
Asish Pal (Asish) → asish.pal@orbitax.com
Enamul Hasan (Enam) → enamul.hasan@orbitax.com
Fayjul Islam (Fayjul) → fayjul.islam@orbitax.com
Ishtiaq Samiul (Samiul) → ishtiaq.samiul@orbitax.com
Md. Amdadul Haque (Amdad) → amdadul.haque@orbitax.com
Md. Jakir Hossen Shagor (Jakir) → jakir.hossen@orbitax.com
Md. Mainul Ahsan (Swaad) → mainul.ahsan@orbitax.com
Md. Masum Billah (Masum) → masum.billah@orbitax.com
Md Mujahedul Azad (Turin) → mujahedul.azad@orbitax.com
Nayeem Hossain (Nayeem) → nayeem.hossain@orbitax.com
Prottya Roy (Prottoy) → prottya.roy@orbitax.com
Riaz Khan (Riaz) → riaz.khan@orbitax.com
Sabbir Hasan (Sabbir) → sabbir.hasan@orbitax.com
Shafi Al Kader (Sopan) → shafi.kader@orbitax.com

TWO EVENT KINDS:

A) TRADE between two roster people (the default).
   CURRENCY RULE (strict): FOOD → "CC"; NON-FOOD → "DC". If the coin stated in
   the message contradicts the item type, OR no coin is stated, set isTrade=false.
   - SELLER receives the coin; BUYER pays it. The author is always one side:
     "sold to X" / "sold X for N" / "gave X … for N" / "X bought from me" /
       "X owes me N"  → AUTHOR = seller, X = buyer.
     "bought from X" / "got X from Y" / "paid X N" / "I owe X N" /
       "X sold me"  → AUTHOR = buyer, X = seller.
   - Resolve X to exactly ONE roster email. Not in roster, ambiguous, or more
     than one trade in the message → isTrade=false.
   - amountCC = the number (integer, in the trade's coin). item = short name.
     No clear amount or item → isTrade=false.
   - One of sellerEmail / buyerEmail MUST equal AUTHOR_EMAIL.
   - Conditional deals: put the condition in brackets after the item, e.g.
     "Kabab(Lifetime on Thursdays)".
   OUTPUT (single-line minified JSON):
   {"type":"trade","isTrade":true,"sellerEmail":"","buyerEmail":"","item":"","amountCC":0,"currency":"CC","confidence":0}

B) PURCHASE — real money (taka / tk / ৳) paid into the Fruit Fund for DC.
   VALID ONLY when AUTHOR_EMAIL is jakir.hossen@orbitax.com. For any other
   author, set isTrade=false.
   - The message names the BUYER (who paid) and the taka amount, e.g.
     "Riaz paid 500 taka to fruit fund for Eid".
   - buyerEmail = the payer, resolved to ONE roster email.
   - amountBdt = the taka number (integer). reason = short purpose ("Eid") or "".
   - Do NOT compute DC — the app converts taka → DC itself.
   OUTPUT (single-line minified JSON):
   {"type":"purchase","isTrade":true,"buyerEmail":"","amountBdt":0,"reason":"","confidence":0}

If NOT recordable, output:
{"type":"trade","isTrade":false,"sellerEmail":"","buyerEmail":"","item":"","amountCC":0,"currency":"CC","confidence":0}

EXAMPLES:
AUTHOR shafi.kader@orbitax.com | "pizza sold to swaad for 40 cc"
→ {"type":"trade","isTrade":true,"sellerEmail":"shafi.kader@orbitax.com","buyerEmail":"mainul.ahsan@orbitax.com","item":"Pizza","amountCC":40,"currency":"CC","confidence":0.97}
AUTHOR riaz.khan@orbitax.com | "bought earbuds from nayeem 20 dc"
→ {"type":"trade","isTrade":true,"sellerEmail":"nayeem.hossain@orbitax.com","buyerEmail":"riaz.khan@orbitax.com","item":"Earbuds","amountCC":20,"currency":"DC","confidence":0.95}
AUTHOR shafi.kader@orbitax.com | "sold burger to swaad for 10 dc"   (food priced in DC — mismatch)
→ {"type":"trade","isTrade":false,"sellerEmail":"","buyerEmail":"","item":"","amountCC":0,"currency":"CC","confidence":0}
AUTHOR jakir.hossen@orbitax.com | "Riaz paid 500 taka to fruit fund for Eid"
→ {"type":"purchase","isTrade":true,"buyerEmail":"riaz.khan@orbitax.com","amountBdt":500,"reason":"Eid","confidence":0.96}
AUTHOR riaz.khan@orbitax.com | "I paid 500 taka to fruit fund"   (author is not the Minister)
→ {"type":"trade","isTrade":false,"sellerEmail":"","buyerEmail":"","item":"","amountCC":0,"currency":"CC","confidence":0}

MESSAGE_TEXT:  from step 1
AUTHOR_EMAIL:  from step 1
```

Delivery to the app is unchanged by these prompt updates. In this Workspace the
Studio "Send a webhook" action is disabled, so the live path is the **Sheet
Bridge**: step 3's JSON is written to the "DesertHouse Inbox" sheet (the `gem`
column), and a standalone Apps Script polls new rows and POSTs
`{token, authorEmail, messageId, gem}` to `/api/desert-house/trade`. The Apps
Script forwards the `gem` verbatim, so the new `type:"purchase"` / `amountBdt`
fields flow through with **no Apps Script change** — only the two prompts (and
the trigger gating above) need updating.

---

## Quick tests (curl)

```bash
# Non-food trade → DC (buyer must hold >= 20 DC)
curl -s -X POST "$APP_URL/api/desert-house/trade?format=text" \
  -H "content-type: application/json" \
  -d '{"token":"<TOKEN>","authorEmail":"riaz.khan@orbitax.com",
       "gem":{"type":"trade","isTrade":true,"sellerEmail":"nayeem.hossain@orbitax.com",
       "buyerEmail":"riaz.khan@orbitax.com","item":"Earbuds","amountCC":20,"currency":"DC"}}'

# Taka → DC purchase (author MUST be the Fruit Minister)
curl -s -X POST "$APP_URL/api/desert-house/trade?format=text" \
  -H "content-type: application/json" \
  -d '{"token":"<TOKEN>","authorEmail":"jakir.hossen@orbitax.com",
       "gem":{"type":"purchase","isTrade":true,"buyerEmail":"riaz.khan@orbitax.com",
       "amountBdt":500,"reason":"Eid"}}'
# → ✅ Recorded (DC purchase): Riaz Khan +681.78 DC for ৳500 (Eid). Fruit Fund is now ৳….
```
