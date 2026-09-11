import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth/verify";
import { listOffers, createOffer } from "@/lib/excel/store";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);
  const offers = await listOffers();
  offers.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ offers });
}

const createSchema = z.object({
  type: z.enum(["SELL", "BUY"]),
  itemName: z.string().trim().min(1).max(80),
  category: z.string().trim().max(40).optional(),
  description: z.string().trim().max(400).optional(),
  priceCC: z.number().int().positive().max(1_000_000),
});

export async function POST(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  const rl = rateLimit(
    `offer:${gate.identity.email}`,
    config.rateLimit.max,
    config.rateLimit.windowMs,
    config.rateLimit.blockMs,
  );
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: `Too many posts — slow down. Try again in ${
          rl.retryAfterMs >= 90000
            ? Math.ceil(rl.retryAfterMs / 60000) + " min"
            : Math.ceil(rl.retryAfterMs / 1000) + "s"
        }.`,
      },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID", message: "Bad JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID", message: "Check the item name and price." },
      { status: 400 },
    );
  }

  try {
    const result = await createOffer(
      { email: gate.identity.email, name: gate.identity.name },
      parsed.data,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
