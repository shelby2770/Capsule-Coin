import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { markArcadeOnboarded } from "@/lib/excel/store";
import { gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — mark the signed-in member's Arcade intro story as seen. */
export async function POST(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);
  const result = await markArcadeOnboarded(gate.identity.email);
  return NextResponse.json(result);
}
