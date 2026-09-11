import { requireMember } from "@/lib/auth/verify";
import { exportWorkbookBuffer } from "@/lib/excel/store";
import { gateResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves the current protected master ledger as a downloadable .xlsx. */
export async function GET(req: Request) {
  const gate = await requireMember(req);
  if (!gate.ok) return gateResponse(gate.status);

  const buf = await exportWorkbookBuffer();
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="capsule-ledger.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
