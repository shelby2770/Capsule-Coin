import "server-only";

import { config } from "@/lib/config";
import { round2 } from "@/lib/format";
import { ALLOWLIST } from "@/lib/allowlist";
import { readState, dcReserveRemaining } from "@/lib/excel/store";
import { valueReport } from "@/lib/value";
import type { PublicOverview } from "@/lib/types";

/**
 * Member-agnostic economy snapshot for the guest tour (/visit). Deliberately
 * exposes only AGGREGATES — the live CC value, the shared DC reserve, and the
 * group size — never any individual member's balance, holdings, or history.
 * Read-only: reconstructs everything from the ledger without mutating it.
 */
export async function publicOverview(): Promise<PublicOverview> {
  const s = await readState();
  const now = Date.now();
  const v = valueReport(s, now);
  const reserve = dcReserveRemaining(s);
  const cap = config.mining.supplyCap;
  return {
    members: ALLOWLIST.length,
    bdtPerCC: v.bdtPerCC,
    usdPerCC: v.usdPerCC,
    change24h: v.change24h,
    dcReserveRemaining: reserve,
    dcSupplyCap: cap,
    dcInCirculation: round2(Math.max(0, cap - reserve)),
  };
}
