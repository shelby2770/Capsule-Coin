import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth/verify";
import { startWord, guessWord, wordState } from "@/lib/games/word";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), tier: z.number().int().min(0).max(3) }),
  z.object({
    action: z.literal("guess"),
    sessionId: z.string().min(1).max(64),
    guess: z.string().min(1).max(12),
  }),
  z.object({ action: z.literal("state"), sessionId: z.string().min(1).max(64) }),
]);

/**
 * POST /api/arcade/word
 *   { action:"start", tier }               → begin a game (spends a play)
 *   { action:"guess", sessionId, guess }   → submit a guess, get colour feedback
 *   { action:"state", sessionId }          → reload the current board (resume)
 */
export async function POST(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID", message: "Bad JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID", message: "Invalid request." }, { status: 400 });
  }

  // Starting a game is the costly action (spends a play) — hold it to the strict
  // anti-bot limit. Guessing is bounded per session (maxAttempts) so it gets a
  // generous limit; a real game makes many quick guesses.
  const rl =
    parsed.data.action === "start"
      ? rateLimit(
          `arcade-word-start:${gate.identity.email}`,
          config.rateLimit.max,
          config.rateLimit.windowMs,
          config.rateLimit.blockMs,
        )
      : rateLimit(`arcade-word-play:${gate.identity.email}`, 120, 60_000, 30_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many requests — slow down a moment." },
      { status: 429 },
    );
  }

  const actor = { email: gate.identity.email, name: gate.identity.name };
  try {
    const d = parsed.data;
    if (d.action === "start") {
      return NextResponse.json(await startWord(actor, d.tier), { status: 201 });
    }
    if (d.action === "guess") {
      return NextResponse.json(await guessWord(actor, d.sessionId, d.guess));
    }
    return NextResponse.json(await wordState(actor, d.sessionId));
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
