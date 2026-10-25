# DesertHouse → Capsule Coin routing (Google-side + app)

The DesertHouse Chat space is watched by a Google Workspace Studio Flow. Two
Gemini steps decide what happened, then the result reaches the app, which settles
it on the ledger (and mirrors to the Google Sheet).

**What's recorded: a CC trade between two members.** Capsule Coin (CC) is the
only tradable currency, and **anything** can be traded for it — goods, food &
drink, services, work/favours, lending/repayment, settled bets. **DC is play-only
and is never traded or transferred between people**, and real-money (taka)
payments are not recorded here. A message priced in DC or in taka is rejected at
step 2 (Gemini answers `no`) and never reaches the app.

> Legacy note: earlier this flow also routed non-food trades to DC and real-money
> "Fruit Fund" top-ups to DC. Both are retired — the flow records CC trades only.
> (The `_DC_` filename is kept only for link continuity.)

---

## App side

`POST /api/desert-house/trade` — the webhook endpoint. Auth is the static
`DESERT_HOUSE_TOKEN` (in the JSON body as `{"token": "..."}`, since the Studio
webhook step has no custom headers; `Authorization: Bearer <token>` also works
for curl). `?format=text` returns just the one-line reply for the Flow's "post a
message" step. Every write is idempotent on `messageId` (a re-fired flow never
double-charges). The trade settles immediately (buyer pays CC, seller receives
CC) via the normal ledger path, so the app UI and the Google Sheet mirror both
update on their own; the memo is tagged "· via DesertHouse".

### Trade payload

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
    "item": "Water pot refill",
    "amountCC": 2,
    "currency": "CC"
  }
}
```

`amountCC` is the CC amount. `currency` is always `"CC"` — the endpoint defaults
to CC, so it may also be omitted (the legacy `isFood`/`DC` routing is no longer
used). One of `sellerEmail` / `buyerEmail` must equal `authorEmail`.

**Split trades (one-to-many).** One seller → several buyers, or several sellers →
one buyer, is sent as `gem.trades: [{sellerEmail,buyerEmail,item,amountCC,currency}, …]`
— one object per counterparty. The endpoint records each leg idempotently: the
first leg keeps the bare `messageId`, extra legs get a `#1`, `#2`… suffix so a
re-fired flow never double-charges. A normal 1:1 trade still sends the flat object
above (no `trades`).

---

## Gemini side (what to paste into the two Studio steps)

Step 2 (the gate) needs only MESSAGE_TEXT. Step 3 (the extractor) needs
MESSAGE_TEXT + AUTHOR_EMAIL + REACTOR_EMAIL — the reactor (whoever confirmed the
trade with an emoji) must be the trade's *other* party, so a one-sided report
can't record on its own.

> **⚠️ Trigger gating:** the Studio Flow trigger should fire on messages
> containing **"cc"** — every trade is priced in CC. Messages without "cc" never
> reach Gemini. (The old dc / taka / fund matches are no longer needed.)

### Step 2 — the yes/no gate

```
You are the first gate for the Capsule Coin ledger. Decide whether the message
reports ONE completed, recordable transaction. Reply with exactly one lowercase
word — yes or no — nothing else. No punctuation, no explanation.

MESSAGE_TEXT: the chat message.

Capsule Coin (CC — also "cc", "coin", "Capsule Coin") is the ONLY tradable
currency, and ANYTHING can be traded for CC between two members:
- goods & items — gadgets, accessories, clothes, books, tickets, gifts, anything.
- food & drink — meals, snacks, tea/coffee, groceries, restaurant orders.
- services & work — a favour or job done for someone (filling a water pot,
  fixing a PC, a ride, printing, errands, etc.).
- lending or repayment of CC, and settled bets / wagers.
Item or service names may be misspelled — read past the typos.

Say YES for ONE completed trade, fully done, with a clear CC amount and clear
counterparties. A single trade MAY be split across several named people at the
same per-person price — one seller → multiple buyers, or multiple sellers → one
buyer (each named person pays/receives the stated CC). Still say YES then:
   • "sold burger to @X for 10 CC"            • "bought pizza from Riaz bhai for 40 cc"
   • "got the phone case from Nayeem for 8 cc"
   • "filled Amdad bhai's water pot for 2 CC" • "fixed Swaad's PC for 15 cc"
   • "lent Riaz 20 cc"                        • "won the bet against Sabbir for 10 cc"
   • "Kabab bought from X for 30 CC for lifetime every Thursday"
   • "two slices of pizza sold to @Swaad and @Adnan for 10 CC each"  (one seller,
     two named buyers, same price → YES)

Say NO for anything else, including:
   • anything priced in DC ("sold earbuds for 20 DC") — DC is play-only and is
     NEVER traded or transferred between people.
   • real money / taka / tk / ৳ ("paid Riaz 100tk for the burger").
   • ads or listings ("selling burgers, 10 CC each").
   • price questions ("how much for the pizza?").
   • open offers / auctions still running ("starting bid 5 CC").
   • no clear CC amount, or general chat with no transaction.

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
- REACTOR_EMAIL: the emoji-reactor's email (trusted; must be the other party)

ROSTER — the only people (name/nickname → email):
Adnan Istiaque (Adnan) → adnan.istiaque@orbitax.com
Asif Anwar (Asif) → asif.anwar@orbitax.com
Ashap Bappy (Bappy) → ashap.bappy@orbitax.com
Asish Pal (Asish) → asish.pal@orbitax.com
Enamul Hasan (Enam) → enamul.hasan@orbitax.com
Fayjul Islam (Fayjul) → fayjul.islam@orbitax.com
Ishtiaq Samiul (Samiul) → ishtiaq.samiul@orbitax.com
Mamun Hossain (Mamun) → mamun.hossain@orbitax.com
Md. Amdadul Haque (Amdad) → amdadul.haque@orbitax.com
Md. Jakir Hossen Shagor (Jakir) → jakir.hossen@orbitax.com
Md. Mainul Ahsan (Swaad) → mainul.ahsan@orbitax.com
Md. Masum Billah (Masum) → masum.billah@orbitax.com
Md Mujahedul Azad (Turin) → mujahedul.azad@orbitax.com
Md. Rejwanul Haque (Rajon) → rejwanul.haque@orbitax.com
Md. Rifatul Islam (Rifat) → rifatul.islam@orbitax.com
Md. Shuhayel Alom Shanto (Shanto) → shuhayel.shanto@orbitax.com
Mestu Paul (Mestu) → mestu.paul@orbitax.com
Nayeem Hossain (Nayeem) → nayeem.hossain@orbitax.com
Prottya Roy (Prottoy) → prottya.roy@orbitax.com
Radoan Islam Nabil (Nabil) → radoan.nabil@orbitax.com
Riaz Khan (Riaz) → riaz.khan@orbitax.com
Ridwanur Rashid Siam (Siam) → ridwanur.siam@orbitax.com
Sabbir Hasan (Sabbir) → sabbir.hasan@orbitax.com
Shafi Al Kader (Sopan) → shafi.kader@orbitax.com

A CC TRADE between two roster people. EVERYTHING trades in CC — goods, food &
drink, services, work/favours, lending/repayment, settled bets. There is no
other tradable currency: if the message is priced in DC, or in real money
(taka / tk / ৳), set isTrade=false.

- SELLER = the person who RECEIVES the CC (is paid). BUYER = the person who PAYS
  the CC. The author is always one side:
    author provided / sold / did it, or is owed  → AUTHOR = seller, other = buyer:
      "sold to X" / "sold X for N" / "gave X … for N" / "did/made/filled/fixed …
      for X for N" / "helped X … for N" / "X bought from me" / "X owes me N" /
      "won the bet against X for N"
    author received / bought it, or owes / paid  → AUTHOR = buyer, other = seller:
      "bought from X" / "got X from Y" / "paid X N" / "I owe X N" / "X sold me" /
      "borrowed from X"
  (A loan the AUTHOR gives — "lent X N" — moves CC from the author to X now, so
   X = seller (receives) and AUTHOR = buyer (pays).)
- SPLIT TRADE (one-to-many): one common party (the AUTHOR) ↔ SEVERAL named
  counterparties at the SAME per-person price (one seller→many buyers, or many
  sellers→one buyer) = still a trade. "10 CC each" / "both for 10 CC" → 10 per leg.
- Resolve each counterparty to exactly ONE roster email. Not in roster/ambiguous, or
  multiple UNRELATED trades (different items/prices, or not involving the author) →
  isTrade=false.
- amountCC = the number (in CC). item = a short name of what was traded
  (the good, dish, service/work, "Loan" or "Bet"). No clear amount or item →
  isTrade=false.
- AUTHOR_EMAIL must be a party on EVERY leg (the common side). REACTOR_EMAIL must be
  a counterparty — the other party (1:1) or ONE of the named counterparties (split).
  Otherwise → isTrade=false.
- Conditional deals: put the condition in brackets after the item, e.g.
  "Kabab(Lifetime on Thursdays)".

OUTPUT (single-line minified JSON):
{"type":"trade","isTrade":true,"sellerEmail":"","buyerEmail":"","item":"","amountCC":0,"currency":"CC","confidence":0}

For a SPLIT trade, output a `trades` array instead — one leg per counterparty:
{"type":"trade","isTrade":true,"trades":[{"sellerEmail":"","buyerEmail":"","item":"","amountCC":0,"currency":"CC"},{"sellerEmail":"","buyerEmail":"","item":"","amountCC":0,"currency":"CC"}],"confidence":0}

If NOT recordable, output:
{"type":"trade","isTrade":false,"sellerEmail":"","buyerEmail":"","item":"","amountCC":0,"currency":"CC","confidence":0}

EXAMPLES:
AUTHOR shafi.kader@orbitax.com | REACTOR mainul.ahsan@orbitax.com | "pizza sold to swaad for 40 cc"
→ {"type":"trade","isTrade":true,"sellerEmail":"shafi.kader@orbitax.com","buyerEmail":"mainul.ahsan@orbitax.com","item":"Pizza","amountCC":40,"currency":"CC","confidence":0.97}
AUTHOR shafi.kader@orbitax.com | REACTOR mainul.ahsan@orbitax.com | "two slices of pizza sold to swaad and adnan for 10 cc each"   (split: one seller → two buyers)
→ {"type":"trade","isTrade":true,"trades":[{"sellerEmail":"shafi.kader@orbitax.com","buyerEmail":"mainul.ahsan@orbitax.com","item":"Pizza","amountCC":10,"currency":"CC"},{"sellerEmail":"shafi.kader@orbitax.com","buyerEmail":"adnan.istiaque@orbitax.com","item":"Pizza","amountCC":10,"currency":"CC"}],"confidence":0.95}
AUTHOR adnan.istiaque@orbitax.com | REACTOR amdadul.haque@orbitax.com | "filled amdad bhai's water pot for 2 cc"
→ {"type":"trade","isTrade":true,"sellerEmail":"adnan.istiaque@orbitax.com","buyerEmail":"amdadul.haque@orbitax.com","item":"Water pot refill","amountCC":2,"currency":"CC","confidence":0.95}
AUTHOR riaz.khan@orbitax.com | REACTOR nayeem.hossain@orbitax.com | "bought earbuds from nayeem 20 cc"
→ {"type":"trade","isTrade":true,"sellerEmail":"nayeem.hossain@orbitax.com","buyerEmail":"riaz.khan@orbitax.com","item":"Earbuds","amountCC":20,"currency":"CC","confidence":0.95}
AUTHOR shafi.kader@orbitax.com | REACTOR mainul.ahsan@orbitax.com | "sold earbuds to swaad for 20 dc"   (priced in DC — not tradable)
→ {"type":"trade","isTrade":false,"sellerEmail":"","buyerEmail":"","item":"","amountCC":0,"currency":"CC","confidence":0}
AUTHOR shafi.kader@orbitax.com | REACTOR riaz.khan@orbitax.com | "sold burger to swaad for 10 cc"   (reactor is not the counterparty)
→ {"type":"trade","isTrade":false,"sellerEmail":"","buyerEmail":"","item":"","amountCC":0,"currency":"CC","confidence":0}

MESSAGE_TEXT:  from step 1
AUTHOR_EMAIL:  from step 1
REACTOR_EMAIL: from step 1
```

Delivery to the app is unchanged by these prompt updates. In this Workspace the
Studio "Send a webhook" action is disabled, so the live path is the **Sheet
Bridge**: step 3's JSON is written to the "DesertHouse Inbox" sheet (the `gem`
column), and a standalone Apps Script polls new rows and POSTs
`{token, authorEmail, messageId, gem}` to `/api/desert-house/trade`. The Apps
Script forwards the `gem` verbatim, so no Apps Script change is needed for this
update — only the two prompts (and the trigger gating above).

---

## Quick test (curl)

```bash
# CC trade — any item/service (buyer may go negative down to the −500 floor)
curl -s -X POST "$APP_URL/api/desert-house/trade?format=text" \
  -H "content-type: application/json" \
  -d '{"token":"<TOKEN>","authorEmail":"adnan.istiaque@orbitax.com",
       "gem":{"type":"trade","isTrade":true,"sellerEmail":"adnan.istiaque@orbitax.com",
       "buyerEmail":"amdadul.haque@orbitax.com","item":"Water pot refill","amountCC":2,"currency":"CC"}}'
# → ✅ Recorded: Adnan Istiaque +2 CC from Md. Amdadul Haque (Water pot refill · via DesertHouse).
```
