import { MODELS, chatStream, errorResponse, hasKey, GroqError } from "@/lib/groq";
import { clientId, overLimit, tooMany } from "@/lib/ratelimit";
import { textStream } from "@/lib/stream";

export const maxDuration = 60;

const MAX_OUTPUT_TOKENS = Number(process.env.GROQ_MAX_OUTPUT_TOKENS) || 4500;
const MAX_CURRENT_CHARS = 16_000;

const SYSTEM = `You are a senior front-end engineer. You turn a short spoken request into a small, working web interface.

Output exactly one complete HTML document and nothing else. No Markdown fences, no explanation.

Rules:
- Start with <!DOCTYPE html>. Put all CSS in one <style> in the head and all JavaScript in one <script> at the end of the body.
- Plain HTML, CSS and JavaScript only. No frameworks.
- No network: no external URLs of any kind. No CDNs, web fonts, remote images, fetch or XHR. Use system fonts, CSS shapes, inline SVG and emoji.
- It must work: every button, input and toggle does what its label says. Keep state in JavaScript variables.
- Fill it with realistic sample content. Never use lorem ipsum.
- Make it look designed: a clear colour palette, good spacing, readable type, visible focus states. It must fit a 360px wide screen and a desktop.
- Label every control. Use real <button>, <label> and <input> elements.
- Stay under 260 lines.`;

const EDIT_NOTE = `You are given the current document and a change request. Apply the change, keep everything else working, and return the full updated document.`;

/**
 * POST /api/generate {request, current?}
 * Streams one HTML document. When "current" is sent, the request is treated as
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
    if (!request) return Response.json({ error: "Say or type what to build first.", code: "empty" }, { status: 400 });

    const parts = chatStream(
      {
        model: MODELS.smart,
        temperature: 0.6,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        reasoning_effort: "low",
        include_reasoning: false,
        messages: current
          ? [
              { role: "system", content: `${SYSTEM}\n\n${EDIT_NOTE}` },
              { role: "user", content: `Current document:\n${current}\n\nChange request: ${request}` },
            ]
          : [
              { role: "system", content: SYSTEM },
              { role: "user", content: `Build this: ${request}` },
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
