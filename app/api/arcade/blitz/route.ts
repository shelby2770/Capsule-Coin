import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth/verify";
import { startBlitz, submitBlitz, reportBlitzGuard } from "@/lib/games/blitz";
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
    answers: z.array(z.number().int().min(-1).max(9)).max(50),
  }),
  z.object({ action: z.literal("guard"), sessionId: z.string().min(1).max(64) }),
]);

/**
 * POST /api/arcade/blitz
 *   { action:"start", tier }              → begin the quiz (spends the free play)
 *   { action:"submit", sessionId, answers } → grade + award DC (correct × dcPerCorrect)
 *   { action:"guard", sessionId }          → copy/screenshot guard (bans on any attempt)
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

  const email = gate.identity.email;
  const action = parsed.data.action;
  const rl =
    action === "start"
      ? rateLimit(
          `arcade-blitz-start:${email}`,
          config.rateLimit.max,
          config.rateLimit.windowMs,
          config.rateLimit.blockMs,
        )
      : action === "guard"
        ? rateLimit(`arcade-blitz-guard:${email}`, 120, 60_000, 30_000)
        : rateLimit(`arcade-blitz-submit:${email}`, 60, 60_000, 30_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many requests — slow down a moment." },
      { status: 429 },
    );
  }

  const actor = { email: gate.identity.email, name: gate.identity.name };
  try {
    const d = parsed.data;
    if (d.action === "start") return NextResponse.json(await startBlitz(actor, d.tier), { status: 201 });
    if (d.action === "guard") return NextResponse.json(await reportBlitzGuard(actor, d.sessionId));
    return NextResponse.json(await submitBlitz(actor, d.sessionId, d.answers));
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
