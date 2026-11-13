# VoxUI

Say what you want and watch a working interface get built. Then change it by talking.

## What it does

- **Speak**: press the button and describe an interface. The orb moves with your voice while it listens.
- **Watch**: your words are transcribed, and a complete HTML document streams into the preview window as it is written.
- **Self-repair**: if the new page throws a script error, VoxUI notices and asks the model to fix it, once, automatically.
- **Refine**: say or type a change. The current document and your request go back to the model, and a new version appears. Every version is kept, so you can step back.
- **Take it away**: read the code, copy it, or download it as one HTML file.
- **Sample**: "Open the sample" loads a hand-written example, so the preview, code view and download can be tried without an API key. It is labelled as a sample.

## How it is built

| Part | Where | Notes |
| --- | --- | --- |
| Voice capture | `components/Studio.tsx` | `MediaRecorder` for the audio, a Web Audio analyser for the live level. |
| Orb | `components/Orb.tsx` | React Three Fiber. A sphere displaced by simplex noise in a vertex shader, driven by the microphone level. |
| Transcription | `app/api/transcribe/route.ts` | Forwards the recording to Groq's Whisper model. |
| Planning | `app/api/generate/route.ts`, `lib/prompts.ts` | A fast model first turns a short request ("x interface") into a concrete brief: which screen, theme, layout and interactions. |
| Generation | `app/api/generate/route.ts` | The strong model streams one HTML document from that brief, with its output budget sized to Groq's per-minute token limit. |
| Design kit | `kit/kit.css`, `kit/kit.js` | A small component stylesheet and icon set injected into every generated page. The model writes markup against it instead of spending its output on basic CSS, and rules that would restyle the kit are stripped. Run `node kit/build.mjs` after editing. |
| Self-repair | `components/Studio.tsx`, `lib/html.ts` | Script errors in the preview are reported back to the app, which sends the page back to the model once to fix them. |
| Safety | `lib/html.ts` | Generated code is treated as untrusted. See below. |

### Running generated code safely

Generated HTML never touches the app's own page:

- It runs in an `<iframe sandbox>` without `allow-same-origin`, so it cannot read the app's cookies, storage or DOM.
- A Content-Security-Policy is injected into every document with `default-src 'none'`, so it cannot load or send anything over the network.
- While a document is still streaming, scripts are switched off. They are enabled only once the document is complete.

Stack: Next.js (App Router), TypeScript, React Three Fiber, three.js, GLSL, Groq (`openai/gpt-oss-120b`, `whisper-large-v3-turbo`).

## Run it locally

```bash
npm install
cp .env.example .env.local   # then add your GROQ_API_KEY
npm run dev
```

Open http://localhost:3000. Voice input needs microphone permission, and browsers only allow that on `localhost` or HTTPS.

## Deploy to Vercel

1. Import the repository in Vercel.
2. Add the environment variable `GROQ_API_KEY`.
3. Deploy.

## Limits

- Recordings stop at 30 seconds.
- A change request sends the whole current document back to the model. On Groq's free plan a large document can hit the per-minute token limit. Lower `GROQ_MAX_OUTPUT_TOKENS` or wait a minute.
- Each visitor is limited to 6 builds a minute.
