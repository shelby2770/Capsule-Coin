import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth/verify";
import { respondNegotiation } from "@/lib/excel/store";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["accept", "counter", "decline"]),
  priceCC: z.number().int().positive().max(1_000_000).optional(),
  note: z.string().trim().max(200).optional(),
});

/** POST /api/negotiations/[id] { action, priceCC?, note? } — respond to a negotiation. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  const rl = rateLimit(
    `negotiate-respond:${gate.identity.email}`,
    config.rateLimit.max,
    config.rateLimit.windowMs,
    config.rateLimit.blockMs,
  );
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: `Too many requests — slow down. Try again in ${
          rl.retryAfterMs >= 90000
            ? Math.ceil(rl.retryAfterMs / 60000) + " min"
            : Math.ceil(rl.retryAfterMs / 1000) + "s"
        }.`,
      },
      { status: 429 },
    );
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID", message: "Bad JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID", message: "Pick accept, counter, or decline." },
      { status: 400 },
    );
  }
  if (parsed.data.action === "counter" && parsed.data.priceCC == null) {
    return NextResponse.json(
      { error: "INVALID", message: "A counter needs a price." },
      { status: 400 },
    );
  }

  try {
    const result = await respondNegotiation(
      { email: gate.identity.email, name: gate.identity.name },
      id,
      parsed.data.action,
      parsed.data.priceCC,
      parsed.data.note ?? "",
    );
    return NextResponse.json(result);
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
