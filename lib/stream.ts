/** Server: stream newline-delimited JSON events from an async job. */
export function ndjson<T>(job: (send: (event: T) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: T) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        await job(send);
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // The client already went away.
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Server: stream plain text chunks from an async generator. */
export function textStream(chunks: AsyncGenerator<string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

/** Client: read a text stream chunk by chunk. */
export async function readText(res: Response, onChunk: (text: string) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

/** Client: read newline-delimited JSON events. */
export async function readNdjson<T>(res: Response, onEvent: (event: T) => void): Promise<void> {
  let buffer = "";
  await readText(res, (text) => {
    buffer += text;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as T);
      } catch {
        // Skip a malformed line rather than dropping the whole stream.
      }
    }
  });
}

/** Client: pull a readable message out of a failed response. */
export async function errorOf(res: Response): Promise<{ message: string; code: string }> {
  try {
    const body = await res.json();
    return { message: body.error ?? `Request failed (${res.status}).`, code: body.code ?? "server" };
  } catch {
    return { message: `Request failed (${res.status}).`, code: "server" };
  }
}
