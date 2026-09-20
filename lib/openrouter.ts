import "server-only";

import { config } from "@/lib/config";
import { LedgerError } from "@/lib/excel/store";

/**
 * Minimal OpenRouter (OpenAI-compatible /chat/completions) client. Server-only —
 * the API key is read from config.openrouter (env OPENROUTER_API_KEY) and never
 * reaches the client. Used by Problem Solving (grading) and, when enabled, AI
 * Blitz (live MCQ generation).
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** True when a key is configured; features gate on this before calling out. */
export function llmConfigured(): boolean {
  return config.openrouter.apiKey.trim().length > 0;
}

/** Raw chat completion → the assistant message text. Throws a LedgerError on any failure. */
export async function chat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; jsonObject?: boolean } = {},
): Promise<string> {
  const { apiKey, model, baseUrl, appUrl, appTitle, timeoutMs } = config.openrouter;
  if (!apiKey.trim()) {
    throw new LedgerError(
      "LLM_UNCONFIGURED",
      "The LLM backend isn't configured yet (OPENROUTER_API_KEY is unset).",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": appUrl,
        "X-Title": appTitle,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 512,
        ...(opts.jsonObject ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new LedgerError(
      "LLM_ERROR",
      aborted ? "The grader timed out — try submitting again." : "Couldn't reach the grader — try again.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new LedgerError("LLM_ERROR", `The grader returned an error (${res.status}). Try again.`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new LedgerError("LLM_ERROR", "The grader sent an unreadable response — try again.");
  }
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
    ?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new LedgerError("LLM_ERROR", "The grader sent an empty response — try again.");
  }
  return content;
}

/**
 * Chat completion parsed as JSON. Tolerates models that wrap JSON in prose or
 * ```json fences by extracting the first {...} / [...] block. Throws LLM_ERROR if
 * nothing parseable is found.
 */
export async function chatJson<T = unknown>(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<T> {
  const raw = await chat(messages, { ...opts, jsonObject: true });
  const parsed = extractJson(raw);
  if (parsed === undefined) {
    throw new LedgerError("LLM_ERROR", "The grader sent malformed output — try again.");
  }
  return parsed as T;
}

/** Best-effort JSON extraction: direct parse, then the first balanced object/array. */
function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to bracket scan */
  }
  const start = trimmed.search(/[[{]/);
  if (start < 0) return undefined;
  const open = trimmed[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === open) depth++;
    else if (trimmed[i] === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
