import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/verify";
import { acceptOffer } from "@/lib/excel/store";
import { ledgerErrorResponse, gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);
  const { id } = await params;
  try {
    const result = await acceptOffer(
      { email: gate.identity.email, name: gate.identity.name },
      id,
    );
    return NextResponse.json(result);
  } catch (e) {
    return ledgerErrorResponse(e);
  }
}
