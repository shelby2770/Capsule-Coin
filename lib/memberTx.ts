import "server-only";
import { allowlistEntry } from "@/lib/allowlist";

/**
 * Shared shaping of a member's transaction history for the public profile —
 * used by both the profile route (first page) and the paging route ("Load more").
 * Rows are newest-first; paging is a simple offset/limit over that stable order.
 */

/** The ledger-row fields these helpers read (a structural subset of a Transaction). */
export type MemberTxRow = {
  seq: number;
  type: string;
  fromEmail: string | null;
  toEmail: string | null;
  amountCC: number;
  currency?: "CC" | "DC";
  memo: string;
  createdAt: string;
};

/** A row shaped for the profile UI. */
export type MappedTx = {
  seq: number;
  type: string;
  direction: "in" | "out" | "mine" | "burn" | "adjust";
  counterpartyName: string;
  amountCC: number;
  currency?: "CC" | "DC";
  memo: string;
  createdAt: string;
};

/** Every row touching this member, newest first (does not mutate the input). */
export function memberRows(txs: MemberTxRow[], email: string): MemberTxRow[] {
  return txs
    .filter((t) => t.fromEmail === email || t.toEmail === email)
    .sort((a, b) => b.seq - a.seq);
}

/**
 * Shape one row for the profile UI (direction + counterparty relative to `email`).
 * Names resolve from the allowlist first, then an optional member-name map (so an
 * ex-member no longer on the allowlist still shows their name, not a raw email),
 * then the email as a last resort.
 */
export function mapMemberTx(
  t: MemberTxRow,
  email: string,
  nameByEmail?: Map<string, string>,
): MappedTx {
  const nameOf = (e: string | null) =>
    e ? allowlistEntry(e)?.name || nameByEmail?.get(e) || e : "";
  let direction: MappedTx["direction"] = "adjust";
  let counterpartyName = "";
  if (t.type === "MINE") direction = "mine";
  else if (t.type === "BURN") direction = "burn";
  else if (t.type === "ADJUST") direction = "adjust";
  else if (t.toEmail === email) {
    direction = "in";
    counterpartyName = nameOf(t.fromEmail);
  } else {
    direction = "out";
    counterpartyName = nameOf(t.toEmail);
  }
  return {
    seq: t.seq,
    type: t.type,
    direction,
    counterpartyName,
    amountCC: t.amountCC,
    currency: t.currency,
    memo: t.memo,
    createdAt: t.createdAt,
  };
}

/** A newest-first page of a member's transactions, plus paging metadata. */
export function pageMemberTx(
  txs: MemberTxRow[],
  email: string,
  offset: number,
  limit: number,
  nameByEmail?: Map<string, string>,
) {
  const all = memberRows(txs, email);
  const start = Math.max(0, offset);
  const slice = all.slice(start, start + Math.max(0, limit));
  return {
    transactions: slice.map((t) => mapMemberTx(t, email, nameByEmail)),
    total: all.length,
    offset: start,
    limit,
    hasMore: start + slice.length < all.length,
  };
}
