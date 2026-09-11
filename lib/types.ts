/**
 * Client-safe shared types (no secrets, safe to import anywhere).
 */
export type MemberPublic = {
  email: string;
  name: string;
  balance: number;
  role: string;
  verified: boolean;
  lastMinedAt: string | null;
  createdAt: string;
};

export type MeResponse =
  | { status: "member"; member: MemberPublic }
  | { status: "notMember"; email: string };

export type LeaderboardRow = {
  rank: number;
  name: string;
  email: string;
  balance: number;
  role: string;
  joined: boolean;
  isYou: boolean;
  sharePct: number;
};

export type LeaderboardResponse = {
  totalSupply: number;
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
    | "BURN";
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
  balance: number;
  reserveRemaining: number; // net CC still mintable before the supply cap
  supplyCap: number;
  rewardCap: number;
  tokensPerSide: number;
  balanceFloor: number;
  resetsAtMs: number; // next daily refill (UTC midnight)
};

export type MineOutcome = {
  reward: number;
  matches: number;
  boosted: boolean; // paid (richer keyspace) attempt
  capped: boolean; // hit the per-mine reward cap
  balance: number;
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
    | "BURN";
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
