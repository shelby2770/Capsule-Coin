import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import {
  buyDcWithMoney,
  fruitFundStatus,
  isFruitMinister,
} from "@/lib/excel/store";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET -> Capsule Fruit Fund status + whether the caller is the Fruit Minister. */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);
  const fund = await fruitFundStatus();
  return NextResponse.json({
    fund,
    isMinister: isFruitMinister(gate.identity.email),
  });
}

/**
 * POST { targetEmail, dcAmount, bdtPaid, note? } — record a real-money DC
 * purchase (Fruit-Minister-only; the store enforces it).
 */
export async function POST(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* validation below will reject empty input */
  }

  try {
    const result = await buyDcWithMoney(gate.identity, {
      targetEmail: String(body?.targetEmail ?? ""),
      dcAmount: Number(body?.dcAmount),
      bdtPaid: Number(body?.bdtPaid),
      note: body?.note ? String(body.note) : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
