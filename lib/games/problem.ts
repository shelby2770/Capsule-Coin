import "server-only";

import { config } from "@/lib/config";
import { round2 } from "@/lib/format";
import { LedgerError, arcadeGate, spendGamePlay, awardGameDc, refundGamePlay } from "@/lib/excel/store";
import { assertValidTier } from "@/lib/games/common";
import { assertCanStart, assertTierNotUsedToday } from "@/lib/games/word";
import { consumeProblem, returnProblem, remainingProblemCount, availableProblemTopics } from "@/lib/games/pools";
import { assertNotProblemBanned, banFromProblem, problemBanUntil } from "@/lib/games/bans";
import {
  createSession,
  getSession,
  saveSession,
  deleteSession,
  type GameSession,
} from "@/lib/games/sessions";
import { chatJson } from "@/lib/openrouter";
import type { ProblemBoard, ProblemGate, ProblemSubmitResult, ProblemCopyResult } from "@/lib/types";

/** Starter code shown in the editor per language. */
const BOILERPLATE = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    // your code here
    return 0;
}
`,
  python: `def solve():
    # your code here
    pass


if __name__ == "__main__":
    solve()
`,
} as const;

/** DC cap for a tier (array length also gates which tiers exist). */
function maxDcFor(tier: number): number {
  return config.games.problem.maxDc[tier] ?? 0;
}

/** Tiers that actually exist for Problem Solving right now (Tier 2/3 are "coming soon"). */
function assertProblemTierLive(tier: number): void {
  if (tier < 0 || tier >= config.games.problem.maxDc.length) {
    throw new LedgerError("TIER_UNAVAILABLE", `Tier ${tier} of Problem Solving isn't available yet.`);
  }
}

/** Pre-start gate for the page: ban state + availability, without spending anything. */
export async function problemGate(email: string): Promise<ProblemGate> {
  const [until, problemsRemaining, topics] = await Promise.all([
    problemBanUntil(email),
    remainingProblemCount(),
    availableProblemTopics(),
  ]);
  return {
    banned: until > 0,
    banUntilMs: until,
    problemsRemaining,
    maxDc: [...config.games.problem.maxDc],
    topics,
  };
}

/** Public board view of a problem session. */
function problemBoard(session: GameSession): ProblemBoard {
  const p = session.problem!;
  const deadlineMs = p.startedAt + config.games.problem.secToSolve * 1000;
  return {
    sessionId: session.id,
    tier: session.tier,
    title: p.title,
    statement: p.statement,
    topic: p.topic,
    difficulty: p.difficulty,
    startedAtMs: p.startedAt,
    deadlineMs,
    secToSolve: config.games.problem.secToSolve,
    maxDc: maxDcFor(session.tier),
    boilerplate: { cpp: BOILERPLATE.cpp, python: BOILERPLATE.python },
    done: session.status !== "active",
  };
}

export async function startProblem(
  actor: { email: string; name: string },
  tier: number,
  topic?: string,
): Promise<ProblemBoard> {
  assertValidTier(tier);
  assertProblemTierLive(tier);
  await assertNotProblemBanned(actor.email);
  const gate = await arcadeGate(actor.email);
  assertCanStart(gate, tier);
  await assertTierNotUsedToday(actor.email, "problem", tier);

  // Free tier draws from its own curated bucket; paid tiers let the player pick a
  // topic (a harder, topic-organized vault). Both are used ONCE (consumed on serve).
  let bucket: string;
  if (tier >= 1) {
    const available = await availableProblemTopics();
    if (!topic || !available.includes(topic)) {
      throw new LedgerError("INVALID_TOPIC", "Choose a topic to start this tier.");
    }
    bucket = topic;
  } else {
    bucket = config.games.problem.freeKey;
  }

  const p = await consumeProblem(bucket);
  const session = await createSession({
    email: actor.email.trim().toLowerCase(),
    kind: "problem",
    tier,
    problem: { ...p, startedAt: Date.now() },
    copiedChars: 0,
  });

  // Charge LAST — never charge without a playable session.
  try {
    await spendGamePlay(actor, tier, "Problem Solving");
  } catch (e) {
    await deleteSession(session.id);
    throw e;
  }
  // Reset the timing anchor to AFTER the charge so the CC round-trip isn't timed.
  session.problem!.startedAt = Date.now();
  await saveSession(session);
  return problemBoard(session);
}

/** Ownership + kind guard shared by the copy + submit paths. */
async function loadOwned(actor: { email: string }, sessionId: string): Promise<GameSession> {
  const session = await getSession(sessionId);
  if (!session || session.kind !== "problem" || !session.problem) {
    throw new LedgerError("SESSION_NOT_FOUND", "That problem session doesn't exist.");
  }
  if (session.email !== actor.email.trim().toLowerCase()) {
    throw new LedgerError("NOT_YOUR_SESSION", "That isn't your game.");
  }
  return session;
}

/**
 * Copy-guard tally. The client reports how many statement characters the player
 * just copied/selected-to-copy; we accumulate it and, once the cumulative fraction
 * crosses config.games.problem.copyBanRatio, ban them from THIS game (not the
 * account) for banDays and close the session. Best-effort — reporting is client-
 * driven — but the ban decision is authoritative here.
 */
export async function reportCopy(
  actor: { email: string },
  sessionId: string,
  chars: number,
): Promise<ProblemCopyResult> {
  const session = await loadOwned(actor, sessionId);
  const statementLen = Math.max(1, session.problem!.statement.length);
  if (session.status !== "active") {
    const until = await problemBanUntil(actor.email);
    return { banned: until > 0, banUntilMs: until, copiedRatio: (session.copiedChars ?? 0) / statementLen };
  }
  const added = Math.max(0, Math.floor(Number(chars) || 0));
  session.copiedChars = (session.copiedChars ?? 0) + added;
  const ratio = session.copiedChars / statementLen;

  if (ratio >= config.games.problem.copyBanRatio) {
    session.status = "abandoned";
    await saveSession(session);
    const banUntilMs = await banFromProblem(actor.email);
    return { banned: true, banUntilMs, copiedRatio: round2(ratio) };
  }
  await saveSession(session);
  return { banned: false, banUntilMs: 0, copiedRatio: round2(ratio) };
}

/** One scored rubric line, surfaced to the player so the mark is transparent. */
export type GradeCriterion = { label: string; score: number; max: number };
type Grade = { mark: number; feedback: string; breakdown: GradeCriterion[] };

/**
 * The judging rubric. The mark is the SUM of four independently-scored criteria
 * (their maxes total 10), not one holistic 0–10 number. Scoring several
 * dimensions is deliberate: a single holistic ask tends to collapse to the
 * extremes (0 or 10), whereas summing partial credit across criteria yields a
 * real distribution and rewards a right-but-buggy attempt instead of zeroing it.
 */
const RUBRIC = [
  { key: "understanding", label: "Approach & understanding", max: 4 },
  { key: "correctness", label: "Correctness", max: 3 },
  { key: "efficiency", label: "Efficiency", max: 2 },
  { key: "completeness", label: "Completeness & edge cases", max: 1 },
] as const;

/** Clamp one model-supplied sub-score into [0, max]; non-numbers → 0. */
function clampScore(v: unknown, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(0, n));
}

/** Grade a submission out of 10 via the LLM. Empty submissions short-circuit to 0. */
async function gradeSubmission(
  statement: string,
  intuition: string,
  code: string,
  language: string,
): Promise<Grade> {
  if (intuition.trim().length === 0 && code.trim().length === 0) {
    return {
      mark: 0,
      feedback: "No solution was submitted.",
      breakdown: RUBRIC.map((r) => ({ label: r.label, score: 0, max: r.max })),
    };
  }
  const system =
    "You are an encouraging but fair competitive-programming judge. You are given a problem statement and a candidate's submission (their approach/intuition and, optionally, code). The code is NOT executed — judge the idea and the code together by reading them. " +
    "Award PARTIAL CREDIT generously: reward a correct or promising idea even when the code is incomplete or has a bug, and reward genuine progress even if the final answer would be wrong. Most real attempts should land in the MIDDLE of the range — reserve near-zero only for empty, irrelevant, or nonsensical submissions, and full marks only for a fully correct, efficient solution. " +
    "Score these four criteria INDEPENDENTLY, each an INTEGER within its own range:\n" +
    "- understanding (0-4): grasp of the problem and a relevant strategy. A correct high-level plan earns 3-4 even without code; a partial or brute-force idea still earns 2.\n" +
    "- correctness (0-3): would the described algorithm/code produce correct output? A small bug (off-by-one, one missed case, a wrong index) keeps 2; a mostly-right idea with real gaps earns 1.\n" +
    "- efficiency (0-2): does it meet the intended time/space complexity? A correct-but-slower approach still earns 1.\n" +
    "- completeness (0-1): complete, runnable code that handles edge cases.\n" +
    "Reply with ONLY minified JSON: {\"understanding\":<int 0-4>,\"correctness\":<int 0-3>,\"efficiency\":<int 0-2>,\"completeness\":<int 0-1>,\"feedback\":\"<one or two sentences: what earned credit and what to improve>\"}.";
  const user =
    `Problem:\n${statement}\n\n---\nCandidate approach / intuition:\n${intuition.trim() || "(none)"}\n\n` +
    `Candidate code (${language}):\n${code.trim() || "(none)"}`;

  const raw = await chatJson<Record<string, unknown>>(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.2, maxTokens: 320 },
  );

  // Prefer the per-criterion rubric; fall back to a holistic `mark` if the model
  // ignored the rubric shape entirely (older-style output).
  const hasRubric = RUBRIC.some((r) => Number.isFinite(Number(raw?.[r.key])));
  let breakdown: GradeCriterion[];
  let mark: number;
  if (hasRubric) {
    breakdown = RUBRIC.map((r) => ({
      label: r.label,
      score: clampScore(raw?.[r.key], r.max),
      max: r.max,
    }));
    mark = breakdown.reduce((a, c) => a + c.score, 0); // 0..10
  } else {
    mark = clampScore(raw?.mark, 10);
    breakdown = [];
  }
  const feedback =
    typeof raw?.feedback === "string" && raw.feedback.trim().length > 0
      ? raw.feedback.trim().slice(0, 400)
      : "Graded.";
  return { mark, feedback, breakdown };
}

/**
 * Grade with a hard time budget. Races the grader against a timeout so a slow or
 * hung LLM can't keep the player waiting indefinitely; on timeout it throws
 * GRADER_TIMEOUT, which submitProblem treats as "couldn't grade" → refund.
 */
async function gradeWithTimeout(
  statement: string,
  intuition: string,
  code: string,
  language: string,
  ms: number,
): Promise<Grade> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new LedgerError("GRADER_TIMEOUT", "The grader took too long to respond.")),
      Math.max(1000, ms),
    );
  });
  try {
    return await Promise.race([gradeSubmission(statement, intuition, code, language), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** True for errors that mean "the grader couldn't score this" → refund the entry. */
function graderUnavailable(e: unknown): boolean {
  return (
    e instanceof LedgerError &&
    (e.code === "GRADER_TIMEOUT" || e.code === "LLM_ERROR" || e.code === "LLM_UNCONFIGURED")
  );
}

export async function submitProblem(
  actor: { email: string; name: string },
  sessionId: string,
  intuition: string,
  code: string,
  language: string,
): Promise<ProblemSubmitResult> {
  const session = await loadOwned(actor, sessionId);
  if (session.status !== "active") {
    throw new LedgerError("SESSION_CLOSED", "This problem is already finished.");
  }
  const lang = language === "python" ? "python" : "cpp";
  const cap = maxDcFor(session.tier);

  // Grade with a hard time budget (config.games.problem.gradeTimeoutMs). If the
  // grader times out or errors, we can't score the solve — so REFUND the entry
  // (CC back for a paid tier, the free play returned for the free tier), put the
  // problem back in the pool, close the session, and mint no DC. Grading before
  // any award also means a successful grade never loses the entry.
  let graded: Grade;
  try {
    graded = await gradeWithTimeout(
      session.problem!.statement,
      String(intuition ?? ""),
      String(code ?? ""),
      lang,
      config.games.problem.gradeTimeoutMs,
    );
  } catch (e) {
    if (!graderUnavailable(e)) throw e;
    const refund = await refundGamePlay(actor, session.tier, "Problem Solving");
    await returnProblem(session.problem!).catch(() => {}); // best-effort; refund already stands
    // Delete the session (rather than mark it) so this counts as a full undo: the
    // "one play per paid tier per day" guard (playedTierToday) sees no record, so
    // the player may replay this tier today with a fresh problem.
    await deleteSession(session.id);
    return {
      mark: 0,
      feedback:
        refund.mode === "free"
          ? "The AI judge couldn't grade your solution in time, so your free play has been returned — try again or pick another game today."
          : `The AI judge couldn't grade your solution in time, so your ${refund.refunded} CC entry has been refunded. Give it another go.`,
      minted: 0,
      totalReward: 0,
      maxDc: cap,
      done: true,
      refunded: { mode: refund.mode, fee: refund.refunded },
    };
  }

  const { mark, feedback, breakdown } = graded;
  const reward = round2((mark / 10) * cap);
  let minted = 0;
  if (reward > 0) {
    const award = await awardGameDc(actor, reward, `Won ${reward} DC — Problem Solving (${mark}/10)`);
    minted = award.minted;
  }
  session.mark = mark;
  session.totalReward = round2((session.totalReward ?? 0) + minted);
  session.status = "done";
  await saveSession(session);

  return {
    mark,
    feedback,
    breakdown,
    minted,
    totalReward: round2(session.totalReward),
    maxDc: cap,
    done: true,
  };
}
