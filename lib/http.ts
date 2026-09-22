import "server-only";

import { NextResponse } from "next/server";
import { LedgerError } from "@/lib/excel/store";

const STATUS: Record<string, number> = {
  OFFER_NOT_FOUND: 404,
  OFFER_NOT_OPEN: 409,
  INSUFFICIENT_FUNDS: 409,
  SELF_TRADE: 400,
  NOT_CREATOR: 403,
  NOT_ADMIN: 403,
  COOLDOWN: 429,
  INVALID: 400,
  // Mining v2
  NO_ATTEMPTS: 409,
  RESERVE_EMPTY: 409,
  FREE_LEFT: 409,
  HAVE_ATTEMPTS: 409,
  MAXED: 409,
  // Transfers
  SELF_TRANSFER: 400,
  NOT_FOUND: 404,
  NOT_PENDING: 409,
  NOT_PAYER: 403,
  // DesertHouse integration
  NOT_MEMBER: 400,
  NOT_PARTICIPANT: 403,
  // Dark Capsule Coin
  INSUFFICIENT_DC: 409,
  DAILY_CAP: 429,
  BANNED: 403,
  GRACE_LOCKED: 409,
  // Arcade games
  NO_FREE_PLAY: 409,
  BAD_TIER: 400,
  POOL_EMPTY: 409,
  SESSION_NOT_FOUND: 404,
  SESSION_CLOSED: 409,
  NOT_YOUR_SESSION: 403,
  BAD_GUESS: 400,
  ATTEMPTS_DONE: 409,
  WRONG_TEXT: 400,
  TOO_FAST: 400,
  GAME_BANNED: 403, // copy/screenshot lockout from a single game (not the account)
};

/** Maps a thrown LedgerError to a clean JSON response; anything else -> 500. */
export function ledgerErrorResponse(e: unknown): NextResponse {
  if (e instanceof LedgerError) {
    return NextResponse.json(
      { error: e.code, message: e.message },
      { status: STATUS[e.code] ?? 400 },
    );
  }
  console.error("Unexpected ledger error:", e);
  return NextResponse.json(
    { error: "SERVER", message: "Something went wrong." },
    { status: 500 },
  );
}

/** Standard 401/403 body for a failed member gate. */
export function gateResponse(status: 401 | 403): NextResponse {
  return NextResponse.json(
    { error: status === 401 ? "unauthenticated" : "notMember" },
    { status },
  );
}
