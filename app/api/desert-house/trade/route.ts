import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import {
  recordDesertHouseTrade,
  recordDesertHousePurchase,
  LedgerError,
} from "@/lib/excel/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// HTTP status for each LedgerError code this route can surface.
const ERROR_STATUS: Record<string, number> = {
  NOT_MEMBER: 400,
  SELF_TRADE: 400,
  NOT_PARTICIPANT: 403,
  INVALID: 400,
  INSUFFICIENT_FUNDS: 409,
  INSUFFICIENT_DC: 409,
  BANNED: 403,
  GRACE_LOCKED: 409,
};
// Outcomes worth echoing back into the chat space (user-actionable).
const REPLY_ON_ERROR = new Set([
  "INSUFFICIENT_FUNDS",
  "INSUFFICIENT_DC",
  "BANNED",
  "GRACE_LOCKED",
  "NOT_PARTICIPANT",
  "SELF_TRADE",
  "INVALID",
]);

/** Constant-time token comparison (avoids leaking length/match timing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const str = (v: unknown) => (v == null ? "" : String(v));

/** JSON by default; plain text (just the message) when ?format=text — so the
 *  Flow's "post a message" step can echo a clean one-liner with no extra step. */
function respond(asText: boolean, payload: Record<string, unknown>, status: number) {
  if (asText) {
    return new NextResponse(str(payload.message), {
      status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json(payload, { status });
}

/** Map a thrown error to a chat-appropriate response (shared by trade + purchase). */
function handleError(asText: boolean, e: unknown) {
  if (e instanceof LedgerError) {
    return respond(
      asText,
      { ok: false, error: e.code, reply: REPLY_ON_ERROR.has(e.code), message: e.message },
      ERROR_STATUS[e.code] ?? 400,
    );
  }
  console.error("[desert-house] unexpected error:", e);
  return respond(
    asText,
    { ok: false, error: "SERVER", reply: false, message: "Something went wrong recording it." },
    500,
  );
}

/**
 * DesertHouse → Capsule Coin trade webhook.
 *
 * A Google Workspace Studio Flow watches the DesertHouse Chat space; when Gemini
 * detects a buy/sell message it POSTs the parsed trade here. Studio's "Send a
 * webhook" step has NO custom headers, so the static token travels in the JSON
 * payload (a header Authorization: Bearer is also accepted, e.g. for curl). The
 * trade settles immediately (buyer pays, seller receives) via the normal ledger
 * path, so the app UI and the Google Sheet mirror both update on their own; the
 * memo is tagged "· via DesertHouse".
 *
 * Auth:   { "token": "<DESERT_HOUSE_TOKEN>" }  (or Authorization: Bearer <token>)
 * Body:   { token, authorEmail, messageId?, rawText?, gem: {isTrade, sellerEmail,
 *           buyerEmail, item, amountCC} }   (trade fields may also be top-level;
 *           `gem` may be an object or a JSON string)
 * Reply:  { ok, reply, message, ... }; ?format=text returns just `message`.
 */
export async function POST(req: Request) {
  const asText = new URL(req.url).searchParams.get("format") === "text";

  const token = process.env.DESERT_HOUSE_TOKEN?.trim();
  if (!token) {
    return respond(
      asText,
      {
        ok: false,
        error: "integration-disabled",
        reply: false,
        message: "DesertHouse integration is not configured.",
      },
      503,
    );
  }

  const raw = await req.text();
  let body: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return respond(
        asText,
        {
          ok: false,
          error: "bad-json",
          reply: false,
          message:
            "Payload isn't valid JSON — have the AI step output minified JSON only (no extra text).",
        },
        400,
      );
    }
  }

  // Token from the Authorization header OR the payload (the webhook step has no
  // header support, so payload is the primary path).
  const authz = req.headers.get("authorization") || "";
  const headerTok = /^bearer\s+/i.test(authz)
    ? authz.replace(/^bearer\s+/i, "").trim()
    : "";
  const provided = headerTok || str(body.token) || str(body.authToken);
  if (!provided || !safeEqual(provided, token)) {
    return respond(
      asText,
      { ok: false, error: "forbidden", reply: false, message: "Bad or missing token." },
      401,
    );
  }

  // Trade fields come from the AI blob (`gem`/`trade` — an object or a JSON
  // string), falling back to top-level keys.
  let gem: unknown = body.gem ?? body.trade ?? null;
  if (typeof gem === "string") {
    try {
      gem = JSON.parse(gem);
    } catch {
      gem = null;
    }
  }
  const src: Record<string, unknown> =
    gem && typeof gem === "object" ? (gem as Record<string, unknown>) : body;

  const sellerEmail = str(src.sellerEmail);
  const buyerEmail = str(src.buyerEmail);
  const item = str(src.item);
  const amountCC = Number(src.amountCC);
  const authorEmail = str(body.authorEmail) || str(src.authorEmail);
  const messageId =
    str(body.messageId) || str(body.externalId) || str(src.messageId);
  const rawText = str(body.rawText) || str(src.rawText);

  // Currency routing: Gemini classifies food vs non-food. "DC" for non-food,
  // "CC" for food. Accepts an explicit `currency`, or an `isFood` boolean; the
  // safe default is CC (DesertHouse is primarily a food-ordering space).
  const currency: "CC" | "DC" = (() => {
    const c = str(src.currency || body.currency).trim().toUpperCase();
    if (c === "DC") return "DC";
    if (c === "CC") return "CC";
    const food = src.isFood ?? body.isFood;
    if (food === false || str(food).toLowerCase() === "false") return "DC";
    return "CC";
  })();

  // ── Purchase branch: real money (taka) → DC into the Fruit Fund ──────────
  // A distinct message kind ("Riaz paid 500 taka to fruit fund for Eid"),
  // reported ONLY by the Fruit Minister. Signalled by type:"purchase" or an
  // amountBdt field. The Minister-only gate is enforced authoritatively in the
  // store against the trusted Chat author (Gemini also gates it upstream).
  const kind = str(src.type || body.type).trim().toLowerCase();
  const amountBdt = Number(src.amountBdt ?? body.amountBdt ?? src.bdt ?? body.bdt);
  const isPurchase =
    kind === "purchase" || (Number.isFinite(amountBdt) && amountBdt > 0);
  if (isPurchase) {
    const pBuyer = str(src.buyerEmail || body.buyerEmail);
    const reason = str(src.reason ?? body.reason ?? src.note ?? body.note);
    if (
      src.isTrade === false ||
      !pBuyer ||
      !Number.isFinite(amountBdt) ||
      amountBdt <= 0
    ) {
      return respond(
        asText,
        { ok: true, recorded: false, skipped: true, reply: false, message: "" },
        200,
      );
    }
    try {
      const result = await recordDesertHousePurchase({
        authorEmail,
        buyerEmail: pBuyer,
        bdtPaid: amountBdt,
        reason: reason || undefined,
        externalId: messageId || undefined,
        rawText: rawText || undefined,
      });
      return respond(asText, { ok: true, reply: result.recorded, ...result }, 200);
    } catch (e) {
      return handleError(asText, e);
    }
  }

  // Not a trade (Gem said so, or too little was parsed to record) → clean no-op,
  // nothing to post back.
  const recordable =
    !!sellerEmail &&
    !!buyerEmail &&
    !!item &&
    Number.isFinite(amountCC) &&
    amountCC > 0;
  if (src.isTrade === false || !recordable) {
    return respond(
      asText,
      { ok: true, recorded: false, skipped: true, reply: false, message: "" },
      200,
    );
  }

  try {
    const result = await recordDesertHouseTrade({
      sellerEmail,
      buyerEmail,
      amountCC,
      item,
      authorEmail,
      currency,
      externalId: messageId || undefined,
      rawText: rawText || undefined,
    });
    return respond(asText, { ok: true, reply: result.recorded, ...result }, 200);
  } catch (e) {
    return handleError(asText, e);
  }
}
