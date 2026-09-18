import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { arcadeStatus } from "@/lib/games/status";
import { gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/arcade — hub status: shared free play, reserve, pool, resumable game. */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);
  return NextResponse.json(await arcadeStatus(gate.identity.email));
}
