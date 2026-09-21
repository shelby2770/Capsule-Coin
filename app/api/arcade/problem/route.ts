import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth/verify";
import { problemGate, startProblem, reportCopy, reportScreenshot, submitProblem } from "@/lib/games/problem";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("gate") }),
  z.object({
    action: z.literal("start"),
    tier: z.number().int().min(0).max(3),
    topic: z.string().max(64).optional(),
  }),
  z.object({
    action: z.literal("copy"),
    sessionId: z.string().min(1).max(64),
    chars: z.number().int().min(0).max(100_000),
  }),
  z.object({
    action: z.literal("screenshot"),
    sessionId: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("submit"),
    sessionId: z.string().min(1).max(64),
    intuition: z.string().max(20_000),
    code: z.string().max(50_000),
    language: z.enum(["cpp", "python"]),
  }),
]);

/**
 * POST /api/arcade/problem
 *   { action:"gate" }                                  → ban / availability (no spend)
 *   { action:"start", tier }                           → begin (spends a play)
 *   { action:"copy", sessionId, chars }                → copy-guard tally (may ban)
 *   { action:"screenshot", sessionId }                 → screenshot-guard (bans on any PrtScn)
 *   { action:"submit", sessionId, intuition, code, language } → grade + award DC
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

  // start + submit are the costly legs (spend a play / call the grader) → strict
  // anti-bot limit. gate + copy are chatty but cheap → a generous per-minute cap.
  const email = gate.identity.email;
  const heavy = parsed.data.action === "start" || parsed.data.action === "submit";
  const rl = heavy
    ? rateLimit(
        `arcade-problem-heavy:${email}`,
        config.rateLimit.max,
        config.rateLimit.windowMs,
        config.rateLimit.blockMs,
      )
    : rateLimit(`arcade-problem-light:${email}`, 120, 60_000, 30_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many requests — slow down a moment." },
      { status: 429 },
    );
  }

  const actor = { email: gate.identity.email, name: gate.identity.name };
  try {
    const d = parsed.data;
    if (d.action === "gate") return NextResponse.json(await problemGate(actor.email));
    if (d.action === "start") return NextResponse.json(await startProblem(actor, d.tier, d.topic), { status: 201 });
    if (d.action === "copy") return NextResponse.json(await reportCopy(actor, d.sessionId, d.chars));
    if (d.action === "screenshot") return NextResponse.json(await reportScreenshot(actor, d.sessionId));
    return NextResponse.json(await submitProblem(actor, d.sessionId, d.intuition, d.code, d.language));
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
