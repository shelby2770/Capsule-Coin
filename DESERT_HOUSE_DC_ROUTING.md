# DesertHouse → DC routing (Google-side change)

Dark Capsule Coin (DC) is spent on **non-food** trades; **food** stays in CC. The app
can't tell food from non-food (item text is free-form), so **Gemini** must classify it
and tell the app which currency to use.

## App side (already done)

`POST /api/desert-house/trade` now accepts a currency signal on the trade object, in
priority order:

1. `currency`: `"CC"` or `"DC"` (explicit) — **preferred**
2. `isFood`: `true` → CC, `false` → DC
3. neither given → defaults to **CC** (safe: DesertHouse is mostly food)

DC trades settle out of the buyer's **DC** wallet (no credit line — the buyer must
actually hold the DC; otherwise the trade is rejected with `INSUFFICIENT_DC`). CC
trades behave exactly as before.

Everything else is unchanged: same token auth, same idempotency (`messageId`), same
`?format=text` reply option.

## Gemini side (what to change)

Add currency classification to the Gemini step that extracts the trade. Update the
**output JSON schema** to include a `currency` field, and add a classification rule to
the prompt.

### Add to the prompt (classification rule)

```
Also classify what was traded:
- If the item is FOOD or drink (meals, snacks, tea/coffee, groceries, restaurant
  orders, etc.), set "currency": "CC".
- If the item is NON-FOOD (gadgets, accessories, clothes, books, services, lending,
  gifts, tickets, anything not edible), set "currency": "DC".
- If unsure, default to "CC".
```

### Updated JSON the flow POSTs (the `gem`/`trade` object)

```json
{
  "isTrade": true,
  "sellerEmail": "seller@orbitax.com",
  "buyerEmail": "buyer@orbitax.com",
  "item": "Wireless earbuds",
  "amountCC": 20,
  "currency": "DC"
}
```

(For a food trade, `"item": "Burger"`, `"currency": "CC"`.)

No other flow steps change. If you'd rather emit a boolean, send `"isFood": true|false`
instead of `currency` — the app maps it the same way.

## Quick test (curl)

```bash
# Non-food -> DC (buyer must hold >= 20 DC)
curl -s -X POST "$APP_URL/api/desert-house/trade?format=text" \
  -H "content-type: application/json" \
  -d '{"token":"<DESERT_HOUSE_TOKEN>","authorEmail":"buyer@orbitax.com",
       "gem":{"isTrade":true,"sellerEmail":"seller@orbitax.com",
       "buyerEmail":"buyer@orbitax.com","item":"Earbuds","amountCC":20,"currency":"DC"}}'
```

The reply echoes the currency, e.g. `✅ Recorded (DC): Earbuds — … +20 DC, … -20 DC`.
