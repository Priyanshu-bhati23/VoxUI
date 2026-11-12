/**
 * Minimal Groq client built on fetch.
 *
 * Groq exposes an OpenAI-compatible API, so there is no SDK here: one helper for
 * a normal completion, one async generator for a streamed completion.
 * Model IDs are read from the environment because Groq retires models often.
 */

const BASE_URL = (process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");

export const MODELS = {
  /** Best reasoning. Used for planning and final answers. */
  smart: process.env.GROQ_MODEL_SMART ?? "openai/gpt-oss-120b",
  /** Fastest. Used for routing, retrieval and worker steps. */
  fast: process.env.GROQ_MODEL_FAST ?? "openai/gpt-oss-20b",
  /** Speech to text. */
  speech: process.env.GROQ_MODEL_SPEECH ?? "whisper-large-v3-turbo",
};

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Message {
  role: Role;
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  max_completion_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high";
  include_reasoning?: boolean;
  response_format?: unknown;
  tools?: unknown[];
  tool_choice?: unknown;
}

export interface ChatResult {
  message: Message;
  finishReason: string;
  usage: Usage;
}

export class GroqError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: "no_key" | "bad_key" | "rate_limited" | "upstream",
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "GroqError";
  }
}

export function hasKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

function authHeaders(): Record<string, string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new GroqError("GROQ_API_KEY is not set on the server.", 503, "no_key");
  }
  return { Authorization: `Bearer ${key}` };
}

async function toError(res: Response): Promise<GroqError> {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message ?? "";
  } catch {
    // The body was not JSON. The status code is enough.
  }
  if (res.status === 401) {
    return new GroqError("Groq rejected the API key. Check GROQ_API_KEY.", 401, "bad_key");
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after")) || undefined;
    const wait = retryAfter ? ` Try again in ${Math.ceil(retryAfter)} seconds.` : "";
    return new GroqError(`Groq rate limit reached.${wait}`, 429, "rate_limited", retryAfter);
  }
  return new GroqError(detail || `Groq returned ${res.status}.`, 502, "upstream");
}

interface Options {
  signal?: AbortSignal;
  /** Called before sleeping on a 429, so callers can tell the user. */
  onWait?: (seconds: number) => void;
}

const MAX_WAIT_SECONDS = 20;

async function post(path: string, body: unknown, opts: Options, attempt = 0): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (res.ok) return res;
  const err = await toError(res);
  // One patient retry on a rate limit, as long as the wait is short.
  if (err.code === "rate_limited" && attempt < 2 && (err.retryAfter ?? 2) <= MAX_WAIT_SECONDS) {
    const seconds = Math.max(1, Math.ceil(err.retryAfter ?? 2));
    opts.onWait?.(seconds);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    return post(path, body, opts, attempt + 1);
  }
  throw err;
}

const EMPTY_USAGE: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

/** One request, one answer. */
export async function chat(req: ChatRequest, opts: Options = {}): Promise<ChatResult> {
  const res = await post("/chat/completions", req, opts);
  const data = await res.json();
  const choice = data?.choices?.[0];
  if (!choice?.message) {
    throw new GroqError("Groq returned an empty response.", 502, "upstream");
  }
  return {
    message: choice.message as Message,
    finishReason: choice.finish_reason ?? "stop",
    usage: (data.usage as Usage) ?? EMPTY_USAGE,
  };
}

export type StreamPart = { type: "text"; text: string } | { type: "usage"; usage: Usage };

/** A streamed completion. Yields text as it arrives, then token usage. */
export async function* chatStream(req: ChatRequest, opts: Options = {}): AsyncGenerator<StreamPart> {
  const res = await post("/chat/completions", { ...req, stream: true }, opts);
  if (!res.body) throw new GroqError("Groq returned no stream.", 502, "upstream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      let chunk: any;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      const text = chunk?.choices?.[0]?.delta?.content;
      if (text) yield { type: "text", text };
      const usage = chunk?.usage ?? chunk?.x_groq?.usage;
      if (usage) yield { type: "usage", usage };
    }
  }
}

/** Parse a JSON answer without trusting it to be clean. */
export function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** Turn any thrown value into a JSON error response the client can show. */
export function errorResponse(err: unknown): Response {
  if (err instanceof GroqError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "Something went wrong on the server.", code: "server" }, { status: 500 });
}
