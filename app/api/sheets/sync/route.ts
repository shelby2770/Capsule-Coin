import { NextResponse } from "next/server";
import { readState } from "@/lib/excel/store";
import { syncNow, sheetsSyncEnabled } from "@/lib/sheets/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Force a full re-push of the ledger to the Google Sheet mirror. Guarded by
 * SEED_TOKEN. Normally the mirror updates automatically after every change;
 * this is for a manual re-sync (e.g. right after connecting the sheet).
 */
export async function POST(req: Request) {
  const token = process.env.SEED_TOKEN;
  if (!token) return NextResponse.json({ error: "disabled" }, { status: 403 });
  if (req.headers.get("x-seed-token") !== token) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!sheetsSyncEnabled()) {
    return NextResponse.json(
      { error: "not-configured", message: "GOOGLE_SHEETS_ID is not set." },
      { status: 400 },
    );
  }
  try {
    await syncNow(await readState());
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[sheets] manual sync failed:", e);
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "sync failed" },
      { status: 500 },
    );
  }
}
