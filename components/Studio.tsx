"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { cleanHtml, forPreview } from "@/lib/html";
import { SAMPLE_HTML, SAMPLE_REQUEST } from "@/lib/sample";
import { errorOf, readText } from "@/lib/stream";
import type { Version } from "@/lib/types";
import type { OrbMode } from "./Orb";

const Orb = dynamic(() => import("./Orb"), { ssr: false });

const STARTERS = [
  "A pricing page with three plans and a monthly or yearly toggle",
  "A tip calculator that splits the bill between friends",
  "A kanban board where I can add cards and move them between columns",
  "A quiz with five questions about space and a score at the end",
];

const MAX_RECORDING_MS = 30_000;

type Phase = "idle" | "listening" | "transcribing" | "building";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function explain(code: string, message: string): string {
  return code === "no_key"
    ? "Building is switched off because the server has no Groq key. Add GROQ_API_KEY to the project's environment variables and redeploy. You can still open the sample."
    : message;
}

export default function Studio() {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("idle");
  const [versions, setVersions] = useState<Version[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const [copied, setCopied] = useState(false);
  const [canRecord, setCanRecord] = useState(true);

  const level = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);

  const active = versions.find((v) => v.id === activeId) ?? null;
  const busy = phase !== "idle";
  const shown = phase === "building" ? draft : (active?.html ?? "");

  useEffect(() => {
    setCanRecord(Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined");
    return () => {
      cleanup.current();
      abort.current?.abort();
    };
  }, []);

  const build = useCallback(
    async (request: string) => {
      const ask = request.trim();
      if (!ask) return;
      setError("");
      setPending(ask);
      setDraft("");
      setTab("preview");
      setPhase("building");
      const controller = new AbortController();
      abort.current = controller;
      const base = versions.find((v) => v.id === activeId) ?? null;

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request: ask, current: base?.html }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const { message, code } = await errorOf(res);
          throw new Error(explain(code, message));
        }

        let raw = "";
        let lastPaint = 0;
        await readText(res, (chunk) => {
          raw += chunk;
          // Repaint the preview a few times a second while the document streams in.
          const now = performance.now();
          if (now - lastPaint > 320) {
            lastPaint = now;
            setDraft(cleanHtml(raw));
          }
        });

        const html = cleanHtml(raw);
        if (!/<(body|main|div|section)\b/i.test(html)) {
          throw new Error("The model did not return a usable page. Try again, or describe it a little differently.");
        }
        const version: Version = { id: nextId.current++, request: ask, html, source: "ai" };
        setVersions((all) => [...all, version]);
        setActiveId(version.id);
        setText("");
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "The build failed. Try again.");
      } finally {
        setPhase("idle");
        setDraft("");
      }
    },
    [versions, activeId],
  );

  const stopListening = () => recorder.current?.state === "recording" && recorder.current.stop();

  const startListening = async () => {
    setError("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("The microphone is blocked. Allow it in your browser's site settings, or type your request instead.");
      return;
    }

    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const measure = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += ((s - 128) / 128) ** 2;
      level.current = Math.sqrt(sum / samples.length);
      frame = requestAnimationFrame(measure);
    };
    measure();

    const mimeType = ["audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const timeout = setTimeout(() => rec.state === "recording" && rec.stop(), MAX_RECORDING_MS);

    cleanup.current = () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((track) => track.stop());
      audio.close().catch(() => {});
      level.current = 0;
      cleanup.current = () => {};
    };

    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      cleanup.current();
      const type = rec.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      if (blob.size < 1200) {
        setPhase("idle");
        setError("That was too short to hear. Press the button, speak, then press it again.");
        return;
      }
      setPhase("transcribing");
      try {
        const form = new FormData();
        form.append("audio", blob, `speech.${type.includes("mp4") ? "m4a" : "webm"}`);
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        if (!res.ok) {
          const { message, code } = await errorOf(res);
          throw new Error(explain(code, message));
        }
        const heard = String((await res.json()).text ?? "").trim();
        if (!heard) throw new Error("No words were heard. Try again a little closer to the microphone.");
        setText(heard);
        await build(heard);
      } catch (err) {
        setPhase("idle");
        setError(err instanceof Error ? err.message : "Transcription failed. Try again.");
      }
    };

    recorder.current = rec;
    rec.start();
    setPhase("listening");
  };

  const openSample = () => {
    const version: Version = { id: nextId.current++, request: SAMPLE_REQUEST, html: SAMPLE_HTML, source: "sample" };
    setVersions((all) => [...all, version]);
    setActiveId(version.id);
    setError("");
    setTab("preview");
  };

  const startOver = () => {
    abort.current?.abort();
    setVersions([]);
    setActiveId(null);
    setText("");
    setError("");
  };

  const copy = async () => {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copying was blocked by the browser. Open the Code tab and copy it from there.");
    }
  };

  const download = () => {
    if (!active) return;
    const url = URL.createObjectURL(new Blob([active.html], { type: "text/html" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "voxui.html";
    link.click();
    URL.revokeObjectURL(url);
  };

  const orbMode: OrbMode = phase === "listening" ? "listening" : phase === "transcribing" ? "thinking" : phase === "building" ? "building" : "idle";
  const status = {
    idle: active ? "Say a change, or type it below." : "Press the button and describe an interface.",
    listening: "Listening. Press again when you are done.",
    transcribing: "Turning your words into text",
    building: "Building it",
  }[phase];

  return (
    <div className="studio">
      <aside className="rail">
        <header className="rail-head">
          <span className="brand">VoxUI</span>
          {versions.length > 0 && (
            <button className="plain" onClick={startOver} disabled={busy}>
              Start over
            </button>
          )}
        </header>

        <div className={`orb orb-${orbMode}`}>
          <Orb mode={orbMode} level={level} reducedMotion={reducedMotion} />
        </div>

        {versions.length === 0 && phase === "idle" ? (
          <h1>Say it. Watch it get built.</h1>
        ) : (
          <p className="status" role="status">
            {status}
          </p>
        )}
        {versions.length === 0 && phase === "idle" && (
          <p className="lede">Describe an interface out loud. A working version appears in the window as it is written, and you can change it by talking.</p>
        )}
        {phase === "building" && pending && <p className="heard">&ldquo;{pending}&rdquo;</p>}

        <div className="controls">
          {canRecord && (
            <button
              className={`mic ${phase === "listening" ? "mic-live" : ""}`}
              onClick={phase === "listening" ? stopListening : startListening}
              disabled={phase === "transcribing" || phase === "building"}
              aria-pressed={phase === "listening"}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                {phase === "listening" ? (
                  <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
                ) : (
                  <>
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </>
                )}
              </svg>
              {phase === "listening" ? "Stop and build" : active ? "Speak a change" : "Speak"}
            </button>
          )}
          <form
            className="typed"
            onSubmit={(e) => {
              e.preventDefault();
              build(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={active ? "Or type a change" : "Or type what to build"}
              aria-label={active ? "Change request" : "What to build"}
              maxLength={800}
              disabled={busy}
            />
            <button disabled={busy || !text.trim()}>{active ? "Change" : "Build"}</button>
          </form>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {versions.length === 0 ? (
          <div className="starters">
            <h2>Ideas to start with</h2>
            {STARTERS.map((starter) => (
              <button key={starter} onClick={() => build(starter)} disabled={busy}>
                {starter}
              </button>
            ))}
          </div>
        ) : (
          <div className="history">
            <h2>Versions</h2>
            <ol>
              {versions.map((version, i) => (
                <li key={version.id}>
                  <button aria-current={version.id === activeId} onClick={() => setActiveId(version.id)} disabled={busy}>
                    <b>{i + 1}</b>
                    <span>{version.request}</span>
                    {version.source === "sample" && <em>Sample</em>}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>

      <main className="window">
        <div className="bar">
          <div className="dots" aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <p className="bar-title">{phase === "building" ? pending : active ? active.request : "Nothing built yet"}</p>
          {(active || phase === "building") && (
            <div className="bar-tools">
              <div className="seg" role="tablist" aria-label="View">
                <button role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")}>
                  Preview
                </button>
                <button role="tab" aria-selected={tab === "code"} onClick={() => setTab("code")}>
                  Code
                </button>
              </div>
              <div className="seg seg-width" role="group" aria-label="Preview width">
                <button aria-pressed={width === "desktop"} onClick={() => setWidth("desktop")}>
                  Desktop
                </button>
                <button aria-pressed={width === "phone"} onClick={() => setWidth("phone")}>
                  Phone
                </button>
              </div>
              <button className="tool" onClick={copy} disabled={!active || busy}>
                {copied ? "Copied" : "Copy code"}
              </button>
              <button className="tool" onClick={download} disabled={!active || busy}>
                Download
              </button>
            </div>
          )}
        </div>

        <div className="canvas">
          {!shown && phase !== "building" ? (
            <div className="empty">
              <h2>Your interface appears here</h2>
              <p>Speak or type a request on the left. To look around first, open the hand-written sample.</p>
              <button onClick={openSample}>Open the sample</button>
            </div>
          ) : tab === "code" ? (
            <pre className="code">
              <code>{shown || "Waiting for the first lines"}</code>
            </pre>
          ) : (
            <div className={`frame frame-${width} ${phase === "building" ? "frame-building" : ""}`}>
              {/* Generated code is untrusted: no same-origin access, and scripts only once the document is complete. */}
              <iframe
                key={phase === "building" ? "draft" : `v${activeId}`}
                title="Preview of the generated interface"
                sandbox={phase === "building" ? "" : "allow-scripts allow-forms"}
                srcDoc={forPreview(shown) || "<!DOCTYPE html><title>Preview</title>"}
              />
              {active?.source === "sample" && phase !== "building" && <span className="badge">Hand-written sample, not AI output</span>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
