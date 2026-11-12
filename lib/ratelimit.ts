/**
 * Best-effort request limiter, kept in memory.
 *
 * Each serverless instance has its own counter, so this is a speed bump rather
 * than a guarantee. It is enough to stop one visitor from draining the API quota
 * by holding down a button. For a hard limit, put a shared store behind it.
 */

const hits = new Map<string, number[]>();

export function clientId(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** Returns seconds to wait if the caller is over the limit, otherwise 0. */
export function overLimit(key: string, limit: number, windowSeconds: number): number {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return Math.ceil((recent[0] + windowMs - now) / 1000);
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return 0;
}

export function tooMany(seconds: number): Response {
  return Response.json(
    { error: `Too many requests. Try again in ${seconds} seconds.`, code: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}
