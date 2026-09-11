import { NextResponse } from "next/server";
import { importLedger } from "@/lib/excel/store";
import { SEED_TRANSACTIONS } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The rebuild writes ~40 transactions + a full Google Sheet sync in one request;
// give it headroom beyond the 10s default (Vercel Hobby allows up to 60s).
export const maxDuration = 60;

/**
 * Ledger import. Guarded by SEED_TOKEN (must be set + matched).
 * - Default: only seeds a fresh ledger (no-op once transactions exist).
 * - `?rebuild=1`: wipes the ledger clean and re-imports the full transaction
 *   history from scratch — every line a real, timestamped trade, no opening
 *   plugs (see lib/seed.ts). Use to rebuild a polluted or out-of-date ledger.
 */
export async function POST(req: Request) {
  const token = process.env.SEED_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "seeding-disabled" }, { status: 403 });
  }
  if (req.headers.get("x-seed-token") !== token) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rebuild = new URL(req.url).searchParams.get("rebuild") === "1";
  const result = await importLedger(SEED_TRANSACTIONS, { rebuild });
  return NextResponse.json(result);
}
