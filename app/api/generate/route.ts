import { MODELS, chat, chatStream, errorResponse, hasKey, GroqError } from "@/lib/groq";
import { BRIEF_SYSTEM, BUILD_SYSTEM, EDIT_NOTE } from "@/lib/prompts";
import { clientId, overLimit, tooMany } from "@/lib/ratelimit";
import { textStream } from "@/lib/stream";

export const maxDuration = 60;

/**
 * Groq counts the prompt plus the requested output against a tokens-per-minute
 * limit, and rejects a request that is larger than the whole limit. The free
 * plan allows 8,000 for this model, so the output budget is whatever the prompt leaves.
 */
const TOKENS_PER_MINUTE = Number(process.env.GROQ_TPM_LIMIT) || 8000;
const MAX_OUTPUT_TOKENS = Number(process.env.GROQ_MAX_OUTPUT_TOKENS) || 6400;
const MAX_CURRENT_CHARS = 14_000;
const REASONING = (process.env.GROQ_REASONING_EFFORT as "low" | "medium" | "high" | undefined) ?? "medium";

/** A rough token count: about one token for every 3.3 characters of code or English. */
const estimateTokens = (text: string) => Math.ceil(text.length / 3.3);

function outputBudget(...promptParts: string[]): number {
  const prompt = promptParts.reduce((sum, part) => sum + estimateTokens(part), 0);
  return Math.max(1200, Math.min(MAX_OUTPUT_TOKENS, TOKENS_PER_MINUTE - prompt - 250));
}

/** Ask the fast model what the person most likely wants. Falls back to the raw request. */
async function writeBrief(request: string, signal: AbortSignal): Promise<string> {
  try {
    const reply = await chat(
      {
        model: MODELS.fast,
        temperature: 0.5,
        max_completion_tokens: 700,
        reasoning_effort: "low",
        include_reasoning: false,
        messages: [
          { role: "system", content: BRIEF_SYSTEM },
          { role: "user", content: request },
        ],
      },
      { signal },
    );
    return (reply.message.content ?? "").trim().slice(0, 1800);
  } catch (err) {
    // A missing or rejected key should surface. Anything else: build from the request alone.
    if (err instanceof GroqError && (err.code === "no_key" || err.code === "bad_key")) throw err;
    return "";
  }
}

/**
 * POST /api/generate {request, current?, intent?}
 * Streams one HTML document. A new build first expands the request into a
 * brief, then builds from it. When "current" is sent, the request is treated as
 * a change to that document.
 */
export async function POST(req: Request) {
  const wait = overLimit(`generate:${clientId(req)}`, 6, 60);
  if (wait) return tooMany(wait);
  try {
    if (!hasKey()) throw new GroqError("GROQ_API_KEY is not set on the server.", 503, "no_key");
    const body = await req.json();
    const request = String(body.request ?? "").trim().slice(0, 800);
    const current = typeof body.current === "string" ? body.current.slice(0, MAX_CURRENT_CHARS) : "";
    const intent = String(body.intent ?? "").trim().slice(0, 400);
    if (!request) return Response.json({ error: "Say or type what to build first.", code: "empty" }, { status: 400 });

    let system = BUILD_SYSTEM;
    let user: string;
    if (current) {
      system = `${BUILD_SYSTEM}\n\n${EDIT_NOTE}`;
      user = `What it was meant to be: ${intent || "not recorded"}\n\nCurrent document:\n${current}\n\nChange request: ${request}`;
    } else {
      const brief = await writeBrief(request, req.signal);
      user = `The person asked for: "${request}"${brief ? `\n\nWhat that means:\n${brief}` : ""}\n\nInvent all the sample content yourself: at least eight realistic items in every feed, list or table.`;
    }

    const parts = chatStream(
      {
        model: MODELS.smart,
        temperature: 0.5,
        max_completion_tokens: outputBudget(system, user),
        reasoning_effort: REASONING,
        include_reasoning: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      { signal: req.signal },
    );

    // Pull the first chunk before answering, so API errors become a real error response.
    const first = await parts.next();
    return textStream(
      (async function* () {
        if (!first.done && first.value.type === "text") yield first.value.text;
        for await (const part of parts) if (part.type === "text") yield part.text;
      })(),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
