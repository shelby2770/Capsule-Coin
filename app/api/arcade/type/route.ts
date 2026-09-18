import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth/verify";
import { startType, submitType, reAttemptType } from "@/lib/games/type";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), tier: z.number().int().min(0).max(3) }),
  z.object({
    action: z.literal("submit"),
    sessionId: z.string().min(1).max(64),
    text: z.string().min(1).max(5000),
    keystrokes: z.number().int().positive().max(100_000).optional(),
  }),
  z.object({ action: z.literal("reattempt"), sessionId: z.string().min(1).max(64) }),
]);

/**
 * POST /api/arcade/type
 *   { action:"start", tier }                      → serve a paragraph (spends a play)
 *   { action:"submit", sessionId, text, ... }     → finish the race, mint DC by WPM
 *   { action:"reattempt", sessionId }             → free retry (fresh paragraph, no charge)
 */
export async function POST(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  const rl = rateLimit(
    `arcade-type:${gate.identity.email}`,
    config.rateLimit.max,
    config.rateLimit.windowMs,
    config.rateLimit.blockMs,
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many requests — slow down a moment." },
      { status: 429 },
    );
  }

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

  const actor = { email: gate.identity.email, name: gate.identity.name };
  try {
    const d = parsed.data;
    if (d.action === "start") {
      return NextResponse.json(await startType(actor, d.tier), { status: 201 });
    }
    if (d.action === "reattempt") {
      return NextResponse.json(await reAttemptType(actor, d.sessionId), { status: 201 });
    }
    return NextResponse.json(await submitType(actor, d.sessionId, d.text, d.keystrokes));
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
