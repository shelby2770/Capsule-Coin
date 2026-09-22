import "server-only";

import { randomUUID } from "crypto";
import { config } from "@/lib/config";
import { round2 } from "@/lib/format";
import { LedgerError, arcadeGate, spendGamePlay, awardGameDc } from "@/lib/excel/store";
import { assertValidTier } from "@/lib/games/common";
import { assertCanStart } from "@/lib/games/word";
import { consumeMcqs } from "@/lib/games/pools";
import { assertNotGameBanned, reportGameGuard } from "@/lib/games/bans";
import {
  createSession,
  getSession,
  saveSession,
  deleteSession,
  type McqItem,
} from "@/lib/games/sessions";
import { chatJson } from "@/lib/openrouter";
import type { BlitzStart, BlitzSubmitResult, GameGuardResult } from "@/lib/types";

/**
 * Hybrid MCQ sourcing. Default: draw from the seeded pool (accurate, no per-play
 * API cost). With config.games.blitz.liveGen on, generate fresh questions via the
 * LLM instead (wired, off by default — vetted-pool answers are more trustworthy).
 */
async function sourceMcqs(n: number): Promise<McqItem[]> {
  if (config.games.blitz.liveGen) {
    return generateMcqsLive(n);
  }
  return consumeMcqs(n);
}

/** LLM-generated MCQs (the "later" half of the hybrid plan). Validated before use. */
async function generateMcqsLive(n: number): Promise<McqItem[]> {
  const system =
    "You are a question writer for a rapid AI/ML quiz. Produce standard, unambiguous multiple-choice questions about RECENT AI/ML developments (LangChain, LangGraph, LangSmith, RAG, agents, evaluations) and AI-assisted software engineering. " +
    `Reply with ONLY a JSON array of exactly ${n} items, each: {"question": "...", "options": ["a","b","c","d"], "answer": <0-3 index of the correct option>, "topic": "..."}. Exactly 4 options each; exactly one correct.`;
  const arr = await chatJson<Array<Record<string, unknown>>>(
    [
      { role: "system", content: system },
      { role: "user", content: `Write ${n} questions now.` },
    ],
    { temperature: 0.7, maxTokens: 1800 },
  );
  if (!Array.isArray(arr)) throw new LedgerError("LLM_ERROR", "The quiz generator sent malformed output.");
  const items: McqItem[] = [];
  for (const q of arr) {
    const question = typeof q?.question === "string" ? q.question.trim() : "";
    const options = Array.isArray(q?.options) ? (q.options as unknown[]).map((o) => String(o)) : [];
    const answer = Number(q?.answer);
    if (question && options.length >= 2 && Number.isInteger(answer) && answer >= 0 && answer < options.length) {
      items.push({ id: randomUUID(), question, options, answer, topic: String(q?.topic ?? "ai") });
    }
    if (items.length >= n) break;
  }
  if (items.length < n) {
    throw new LedgerError("LLM_ERROR", "The quiz generator didn't return enough valid questions.");
  }
  return items;
}

/** Client view of a question — the answer index is stripped. */
function publicQuestions(mcqs: McqItem[]) {
  return mcqs.map((q) => ({ question: q.question, options: q.options }));
}

export async function startBlitz(
  actor: { email: string; name: string },
  tier: number,
): Promise<BlitzStart> {
  assertValidTier(tier);
  if (tier !== 0) {
    throw new LedgerError("TIER_UNAVAILABLE", "AI Blitz is free-tier only.");
  }
  await assertNotGameBanned(actor.email, "blitz");
  const gate = await arcadeGate(actor.email);
  assertCanStart(gate, 0);

  const mcqs = await sourceMcqs(config.games.blitz.questionCount);
  const session = await createSession({
    email: actor.email.trim().toLowerCase(),
    kind: "blitz",
    tier: 0,
    mcqs,
    mcqStartedAt: Date.now(),
    answers: [],
  });

  // Charge LAST (the shared free play) — never without a playable session.
  try {
    await spendGamePlay(actor, 0, "AI Blitz");
  } catch (e) {
    await deleteSession(session.id);
    throw e;
  }
  session.mcqStartedAt = Date.now(); // re-anchor after the charge round-trip
  await saveSession(session);

  return {
    sessionId: session.id,
    questions: publicQuestions(mcqs),
    secPerQuestion: config.games.blitz.secPerQuestion,
    startedAtMs: session.mcqStartedAt,
    dcPerCorrect: config.games.blitz.dcPerCorrect,
  };
}

/**
 * Copy/screenshot guard. Copying a question to feed an LLM is the cheat, so ANY
 * reported copy attempt or detected PrtScn bans the member from AI Blitz (this
 * game only) for banDays and abandons the session. Best-effort + client-driven;
 * the ban decision is authoritative server-side (see reportGameGuard).
 */
export function reportBlitzGuard(
  actor: { email: string },
  sessionId: string,
): Promise<GameGuardResult> {
  return reportGameGuard(actor, sessionId, "blitz");
}

export async function submitBlitz(
  actor: { email: string; name: string },
  sessionId: string,
  chosenRaw: number[],
): Promise<BlitzSubmitResult> {
  const session = await getSession(sessionId);
  if (!session || session.kind !== "blitz" || !session.mcqs) {
    throw new LedgerError("SESSION_NOT_FOUND", "That quiz session doesn't exist.");
  }
  if (session.email !== actor.email.trim().toLowerCase()) {
    throw new LedgerError("NOT_YOUR_SESSION", "That isn't your game.");
  }
  if (session.status !== "active") throw new LedgerError("SESSION_CLOSED", "This quiz is already over.");

  const mcqs = session.mcqs;
  // Normalize the answer vector to one entry per question (-1 = unanswered).
  const chosen = mcqs.map((q, i) => {
    const v = Math.trunc(Number(chosenRaw?.[i]));
    return Number.isInteger(v) && v >= 0 && v < q.options.length ? v : -1;
  });

  // Anti-cheat: a real run can't come back in a blink. Rather than reject the
  // submission (which would close the session and strand the client in a retry
  // loop), we still score it and return a result — but award no DC.
  const elapsedSec = (Date.now() - (session.mcqStartedAt || Date.now())) / 1000;
  const tooFast = elapsedSec < 5;

  const correct = mcqs.reduce((acc, q, i) => acc + (chosen[i] === q.answer ? 1 : 0), 0);
  const reward = tooFast ? 0 : round2(correct * config.games.blitz.dcPerCorrect);
  let minted = 0;
  if (reward > 0) {
    const award = await awardGameDc(actor, reward, `Won ${reward} DC — AI Blitz (${correct}/${mcqs.length})`);
    minted = award.minted;
  }
  session.answers = chosen;
  session.totalReward = round2((session.totalReward ?? 0) + minted);
  session.status = "done";
  await saveSession(session);

  return {
    correct,
    total: mcqs.length,
    minted,
    totalReward: round2(session.totalReward),
    chosen,
    correctAnswers: mcqs.map((q) => q.answer),
    explanations: mcqs.map((q) => q.explanation ?? ""),
    tooFast,
  };
}
