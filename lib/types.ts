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
  arcadeOnboardedAt: string | null; // when they finished the Arcade intro; null = show story
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
    | "PURCHASE"
    | "GAME";
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
  freeRemaining: number; // free mines left today (0 once today's free play went to a game)
  freePerDay: number;
  freeTrack: "none" | "mining" | "games"; // which track today's single free allowance is locked to
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
    | "PURCHASE"
    | "GAME";
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

// ── Arcade games (earn DC through Wordle-style + type-racing games) ──────────
export type GameKind = "word" | "type" | "problem" | "blitz";

/** Hub status: shared free-play budget, the reserve, and per-game affordances. */
export type ArcadeStatus = {
  freeRemaining: number; // free game plays left today (0 once today's free play went to mining)
  freePlaysPerDay: number;
  freeTrack: "none" | "mining" | "games"; // which track today's single free allowance is locked to
  mineFreeRemaining: number; // free mines left today (0 once today's free play went to a game)
  reserveRemaining: number; // shared DC mining reserve headroom
  supplyCap: number;
  balance: number; // CC wallet (for affording paid tiers)
  dcBalance: number;
  standing: "OK" | "GRACE" | "BANNED";
  resetsAtMs: number; // next daily refill (UTC midnight)
  tierFees: number[]; // CC fee for tiers 1..3
  wordsRemaining: number; // words left in the pool
  paragraphsRemaining: number; // typing passages available (reused, not consumed)
  problemsRemaining: number; // problem-solving problems available (reused)
  mcqRemaining: number; // AI Blitz questions available (reused)
  wordCounts: number[]; // words guessed per tier [free, 1, 2, 3]
  resumable: { kind: GameKind; sessionId: string } | null; // an unfinished game to resume
  bans: Record<GameKind, number>; // per-game copy/screenshot ban lift time (ms epoch; 0 = not banned)
};

export type GameLetterState = "correct" | "present" | "absent";
export type WordBoardAttempt = { guess: string; feedback: GameLetterState[] };

/** Public view of a word-guessing session — carries the answer only once the session is over. */
export type WordBoard = {
  sessionId: string;
  tier: number;
  wordsTotal: number;
  wordIndex: number; // which word (0-based) is showing
  wordsSolved: number;
  wordLength: number;
  maxAttempts: number;
  attemptsUsed: number;
  attempts: WordBoardAttempt[]; // guesses + colour feedback for the current word
  done: boolean;
  revealed?: string | null; // the current word's answer — only once the session is over (e.g. time ran out); never during play
  totalReward: number; // DC minted across the session so far
  wordElapsedMs: number; // server time on the CURRENT word (resets each word, persists across re-entry)
  elapsedMs: number; // server-measured time since the session started (persists across re-entry)
  ttlMs: number; // session lifespan — closes + finalizes once elapsed reaches this
};

export type WordGuessResult = {
  feedback: GameLetterState[];
  solved: boolean;
  minted: number; // DC minted for this word (0 if not solved / reserve empty)
  attemptsUsed: number;
  attemptsLeft: number;
  wordComplete: boolean; // solved OR out of attempts
  revealed: string | null; // the answer, only when the word was failed
  done: boolean; // whole session finished
  wordsSolved: number;
  wordsTotal: number;
  totalReward: number;
  next: { wordIndex: number; wordLength: number; attemptsUsed: number } | null;
};

/** Type-racing session start — the paragraph text is sent (it's what you type). */
export type TypeStart = {
  sessionId: string;
  tier: number;
  text: string;
  difficulty: number;
  startedAtMs: number; // server timing anchor (authoritative) — set in the FUTURE by countdownMs
  countdownMs: number; // "get ready" breather before the clock starts (startedAtMs − now)
  reAttemptsLeft: number; // free retries remaining on this paid entry
};

export type TypeSubmitResult = {
  wpm: number;
  accuracy: number; // % of keystrokes correct (display only; no DC bonus)
  elapsedSec: number;
  minted: number; // DC minted for THIS run (0 if it didn't beat your best)
  totalReward: number; // DC minted across the whole entry (best run so far)
  bestWpm: number; // best WPM across all attempts on this entry
  improved: boolean; // did this run set a new best (and mint a top-up)?
  reAttemptsLeft: number; // free retries still available
};

// ── Problem Solving (LeetCode-style, LLM-graded) ────────────────────────────
/** Pre-start gate — lets the page show a ban screen / availability without spending. */
export type ProblemGate = {
  banned: boolean;
  banUntilMs: number; // 0 when not banned
  problemsRemaining: number;
  maxDc: number[]; // internal: length = how many tiers exist (values not shown to players)
  topics: string[]; // topics with problems — offered when a paid tier picks a topic
};

/** Public view of a problem session — the statement is sent (reading it IS the game). */
export type ProblemBoard = {
  sessionId: string;
  tier: number;
  title: string;
  statement: string;
  topic: string;
  difficulty: number;
  startedAtMs: number; // server timing anchor
  deadlineMs: number; // startedAtMs + secToSolve×1000 (hard auto-submit)
  secToSolve: number;
  maxDc: number; // this tier's DC cap
  boilerplate: { cpp: string; python: string };
  done: boolean; // session already finished/graded
};

export type ProblemSubmitResult = {
  mark: number; // grader's mark, 0..10 (sum of the rubric breakdown)
  feedback: string; // one/two-sentence grader note
  breakdown?: { label: string; score: number; max: number }[]; // per-criterion rubric scores (empty on fallback)
  minted: number; // DC minted this submit
  totalReward: number; // DC on this entry
  maxDc: number; // the tier cap the mark was scaled against
  done: boolean;
  refunded?: { mode: "free" | "paid"; fee: number }; // set when grading failed and the entry was returned
};

/** Copy-guard tally response — the server bans once the copied fraction crosses the ratio. */
export type ProblemCopyResult = {
  banned: boolean;
  banUntilMs: number; // 0 when not (yet) banned
  copiedRatio: number; // cumulative copied chars / statement length
};

/** Screenshot-guard response — the server bans immediately on a detected PrtScn. */
export type ProblemScreenshotResult = {
  banned: boolean;
  banUntilMs: number; // 0 when not banned
};

/**
 * Copy/screenshot guard response for Guess the Word + AI Blitz. There's nothing
 * legitimate to copy in these games, so ANY copy attempt or detected screenshot
 * bans the member from THAT game (this game only) — no ratio, unlike the longer
 * Problem-Solving statement.
 */
export type GameGuardResult = {
  banned: boolean;
  banUntilMs: number; // 0 when not banned
};

/**
 * Aggregate, member-agnostic economy stats for the guest tour (/visit). Exposes
 * ONLY group-level numbers — never any individual member's balance or history.
 */
export type PublicOverview = {
  members: number; // size of the Capsule group (the allowlist)
  bdtPerCC: number; // live CC value in BDT (the headline rate)
  usdPerCC: number; // live CC value in USD
  change24h: number | null; // 24h % change, or null before 24h of history exists
  dcReserveRemaining: number; // shared DC reserve headroom left
  dcSupplyCap: number; // fixed DC supply cap
  dcInCirculation: number; // cap − reserve (DC forged and still out there)
};

// ── AI Blitz (rapid-fire AI/ML MCQ) ─────────────────────────────────────────
export type BlitzQuestion = { question: string; options: string[] }; // never carries the answer

export type BlitzStart = {
  sessionId: string;
  questions: BlitzQuestion[];
  secPerQuestion: number;
  startedAtMs: number;
  dcPerCorrect: number;
};

export type BlitzSubmitResult = {
  correct: number;
  total: number;
  minted: number; // DC minted (correct × dcPerCorrect, reserve-capped)
  totalReward: number;
  chosen: number[]; // what the player picked per question (-1 = unanswered)
  correctAnswers: number[]; // the right option index per question (for review)
  explanations: string[]; // per-question explanation, revealed only now (empty string = none)
  tooFast: boolean; // submitted implausibly fast → scored but no DC awarded
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
