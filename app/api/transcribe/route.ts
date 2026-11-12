import { MODELS, errorResponse, hasKey, GroqError } from "@/lib/groq";
import { clientId, overLimit, tooMany } from "@/lib/ratelimit";

export const maxDuration = 30;

const BASE_URL = (process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
const MAX_BYTES = 4 * 1024 * 1024;

/** POST /api/transcribe (multipart form, field "audio") -> {text} */
export async function POST(req: Request) {
  const wait = overLimit(`transcribe:${clientId(req)}`, 10, 60);
  if (wait) return tooMany(wait);
  try {
    if (!hasKey()) throw new GroqError("GROQ_API_KEY is not set on the server.", 503, "no_key");

    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0) {
      return Response.json({ error: "No audio was received. Try recording again.", code: "empty" }, { status: 400 });
    }
    if (audio.size > MAX_BYTES) {
      return Response.json({ error: "That recording is too long. Keep it under 30 seconds.", code: "too_large" }, { status: 413 });
    }

    const upstream = new FormData();
    upstream.append("file", audio, audio.name || "speech.webm");
    upstream.append("model", MODELS.speech);
    upstream.append("response_format", "json");
    upstream.append("language", "en");

    const res = await fetch(`${BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: upstream,
    });
    if (!res.ok) {
      if (res.status === 401) throw new GroqError("Groq rejected the API key. Check GROQ_API_KEY.", 401, "bad_key");
      if (res.status === 429) throw new GroqError("Groq's rate limit was reached. Wait a moment and try again.", 429, "rate_limited");
      throw new GroqError(`Transcription failed (${res.status}).`, 502, "upstream");
    }
    const data = (await res.json()) as { text?: string };
    return Response.json({ text: (data.text ?? "").trim() });
  } catch (err) {
    return errorResponse(err);
  }
}
