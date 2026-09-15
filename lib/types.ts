/**
 * Client-safe shared types (no secrets, safe to import anywhere).
 */
/** Which coin an amount is in. */
export type Currency = "CC" | "DC";

export type MemberPublic = {
  email: string;
  name: string;
  balance: number; // CC wallet
  dcBalance: number; // Dark Capsule Coin wallet (never negative)
  role: string;
  verified: boolean;
  lastMinedAt: string | null;
  createdAt: string;
  graceUntil: string | null; // ISO deadline while below the credit floor, else null
  banned: boolean; // permanent lockout (missed the grace deadline)
  onboardedAt: string | null; // when they finished the DC intro; null = show story
};

export type MeResponse =
  | { status: "member"; member: MemberPublic }
  | { status: "notMember"; email: string };

export type LeaderboardRow = {
  rank: number;
  name: string;
  email: string;
  balance: number;
  dcBalance: number; // Dark Capsule Coin holdings (for the DC leaderboard)
  banned: boolean; // account frozen (grace deadline missed)
  role: string;
  joined: boolean;
  isYou: boolean;
  sharePct: number;
};

export type LeaderboardResponse = {
  totalSupply: number;
  totalDc: number; // sum of all DC holdings (DC leaderboard "supply")
  memberCount: number; // total allowlisted
  joinedCount: number; // wallets created so far
  rows: LeaderboardRow[];
};

export type OfferType = "SELL" | "BUY";
export type OfferStatus = "OPEN" | "COMPLETED" | "CANCELLED";

export type OfferPublic = {
  id: string;
  type: OfferType;
  creatorEmail: string;
  creatorName: string;
  itemName: string;
  category: string;
  description: string;
  priceCC: number;
  status: OfferStatus;
  counterpartyEmail: string | null;
  counterpartyName: string | null;
  escrowAmount: number;
  createdAt: string;
  closedAt: string | null;
};

// ── Marketplace negotiation (haggle on a SELL offer) ────────────────────────
export type NegotiationParty = "BUYER" | "SELLER";
export type NegotiationStatusPublic =
  | "OPEN"
  | "ACCEPTED"
  | "DECLINED"
  | "WITHDRAWN"
  | "CANCELLED";

export type NegotiationMessagePublic = {
  by: NegotiationParty;
  priceCC: number;
  note: string;
  at: string;
};

export type NegotiationPublic = {
  id: string;
  offerId: string;
  itemName: string;
  sellerName: string;
  buyerName: string;
  status: NegotiationStatusPublic;
  currentPriceCC: number;
  listPriceCC: number | null; // the offer's current list price, if it's still open
  turn: NegotiationParty; // who should respond next
  role: "buyer" | "seller"; // the viewer's side of this negotiation
  yourTurn: boolean; // true when it's the viewer's move
  messages: NegotiationMessagePublic[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type TransferStatus =
  | "PENDING"
  | "APPROVED"
  | "DECLINED"
  | "CANCELLED"
  | "EXPIRED";

export type TransferRequestPublic = {
  id: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName: string;
  amountCC: number;
  item: string;
  note: string;
  initiatedBy: "PAYER" | "PAYEE";
  status: TransferStatus;
  createdAt: string;
  resolvedAt: string | null;
  // relationship to the viewer (filled per-request by the API)
  role: "payer" | "payee" | "other";
  canApprove: boolean; // viewer is the payer of a pending request
  canCancel: boolean; // viewer initiated a pending request
};

export type TransfersResponse = {
  incoming: TransferRequestPublic[]; // pending, awaiting the viewer's approval
  outgoing: TransferRequestPublic[]; // pending, initiated by the viewer
  pending: TransferRequestPublic[]; // all currently-pending (public)
  recent: TransferRequestPublic[]; // recently resolved
  pendingForMe: number; // count awaiting the viewer's approval (nav badge)
};

export type TransactionPublic = {
  seq: number;
  id: string;
  type:
    | "MINE"
    | "TRADE"
    | "TRANSFER"
    | "ESCROW_LOCK"
    | "ESCROW_REFUND"
    | "ADJUST"
    | "BURN"
    | "CONVERT"
    | "PURCHASE";
  currency: Currency;
  fromEmail: string | null;
  toEmail: string | null;
  amountCC: number;
  offerId: string | null;
  memo: string;
  createdAt: string;
};

export type MiningTier = { index: number; fee: number; mines: number };

export type MiningStatus = {
  freeRemaining: number;
  freePerDay: number;
  paidRemaining: number;
  tier: number; // how many pay-to-mine packs unlocked today (0..ladder.length)
  nextTier: MiningTier | null; // next purchasable pack, or null when maxed out
  canMine: boolean; // has an attempt AND the reserve isn't empty
  balance: number; // CC wallet
  dcBalance: number; // DC wallet (mining pays into this)
  reserveRemaining: number; // net DC still mintable before the supply cap
  supplyCap: number;
  rewardCap: number;
  tokensPerSide: number;
  balanceFloor: number;
  resetsAtMs: number; // next daily refill (UTC midnight)
  standing: "OK" | "GRACE" | "BANNED"; // credit-floor standing
  graceUntil: string | null; // ISO deadline while in grace, else null
};

export type MineOutcome = {
  reward: number; // DC minted this attempt
  matches: number;
  boosted: boolean; // paid (richer keyspace) attempt
  capped: boolean; // hit the per-mine reward cap
  balance: number; // CC wallet (unchanged by mining)
  dcBalance: number; // DC wallet after this mine
  freeRemaining: number;
  paidRemaining: number;
  reserveRemaining: number;
};

export type BuyPackOutcome = {
  balance: number;
  tier: number;
  paidRemaining: number;
  nextTier: MiningTier | null;
  fee: number;
  mines: number;
};

export type ValuePoint = { t: number; value: number };
export type BalancePoint = { t: number; balance: number };

export type LedgerTx = {
  seq: number;
  type:
    | "MINE"
    | "TRADE"
    | "TRANSFER"
    | "ESCROW_LOCK"
    | "ESCROW_REFUND"
    | "ADJUST"
    | "BURN"
    | "CONVERT"
    | "PURCHASE";
  currency: Currency;
  fromName: string | null;
  toName: string | null;
  amountCC: number;
  memo: string;
  createdAt: string;
};

export type LedgerView = {
  transactions: LedgerTx[];
  txCount: number;
  totalVolume: number;
  memberCount: number;
};

export type ValueResponse = {
  index: number;
  supply: number;
  demand: number;
  change24h: number | null;
  k: number;
  windowDays: number;
  bdtPerCC: number;
  usdPerCC: number;
  usdBdtRate: number;
  spread: number;
  balanceFloor: number;
  series: ValuePoint[];
};

/** DC -> CC market-rate report (spot rate for 1 DC + the supply scarcity band). */
export type DcRateResponse = {
  ccPerDc: number; // CC you get per DC at the reference amount (the spot rate)
  refAmount: number; // reference conversion size the spot rate is quoted at (1 DC)
  multiplier: number; // supply scarcity multiplier m(S) — the market-driven part
  supply: number; // total DC in circulation
  change24h: number | null;
  clampMin: number; // floor of the scarcity multiplier
  clampMax: number; // ceiling of the scarcity multiplier
  series: ValuePoint[]; // per-DC rate over the last 24h
};

/** A marketplace offer as broadcast in the notifications feed (all members). */
export type OfferFeedItem = {
  id: string;
  type: OfferType;
  itemName: string;
  category: string;
  priceCC: number;
  creatorName: string;
  creatorEmail: string;
  createdAt: string;
};
