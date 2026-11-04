# ProActive Assistant

**A real-time meeting companion that speaks up only when it's worth it.**

Turn it on during a meeting and it transcribes the conversation live with **Muse Voice Transcribe**. **Muse Wonder** watches the transcript and, without being asked, surfaces short insight cards: it explains jargon and acronyms, flags claims that look wrong, suggests sharp questions, and captures decisions and action items. When the meeting ends you get a summary, a list of decisions and an action-item checklist, all exportable as Markdown.

Built for the Meta Global AI Developer Hackathon.

**Live demo:** https://main.d3q8ybdgvoif2l.amplifyapp.com (backend: https://promet-api.viettrans.info). Choose **Settings → Audio source → Demo meeting** for the scripted sample, or press **Start** and talk.

## Features

- **Live transcript** with partial (gray) and final lines, timestamps and speaker labels (Muse diarization).
- **Proactive insights**: definition, background, fact check, question to ask, action item, decision, related idea. You can pin, dismiss, copy, ask for "tell me more", or click the quote to jump to that moment in the transcript.
- **Live web search**: when someone states something time-sensitive (a price, an exchange rate, today's news), the model can call a `web_search` tool. The insight panel shows "Searching: …" and the card cites the live figure. Stable facts and definitions never trigger a search.
- **Calm by design**: debounced triggers, a minimum interval between calls, one call at a time, de-duplication, confidence filtering and at most one card per type per call.
- **Audio sources**: microphone (with device picker), a browser tab (Meet/Zoom web/Teams web in Chrome/Edge), mic + tab, or the built-in demo meeting.
- **End-of-meeting notes**: summary, decisions and action items with owner and due date, plus pinned insights and the full transcript. Export as `.md` or copy.
- **Resilient**: the browser-to-server and server-to-Muse links both reconnect automatically. Audio captured while disconnected is buffered and replayed. A half-spoken line is kept when a connection drops. The transcript survives page reloads (stored in the browser only).
- **Demo mode**: a 2.5-minute scripted meeting (4 voices). It can run through the live Muse pipeline, or fully **offline** with a pre-recorded transcript and insights for bad conference Wi-Fi.
- **Privacy**: API keys stay on the server; there is no server-side storage; a visible REC indicator and a consent reminder are shown.
- Light and dark mode, responsive layout (panels stack on mobile).

## Architecture

```mermaid
flowchart LR
  subgraph Browser["apps/web · Next.js"]
    SRC[Mic / Tab / Demo audio] --> AW[AudioWorklet<br/>24 kHz PCM16, 100 ms]
    AW --> WSC[WsClient<br/>auto-reconnect + 30 s buffer]
    WSC --> ST[(Zustand store<br/>persisted locally)]
    ST --> UI[Transcript · Insights · Summary]
  end
  subgraph Server["apps/server · Node.js + ws"]
    GW[HTTP + WS gateway<br/>Origin check · HMAC token · rate limits] --> SES[Session]
    SES --> STT[STTProvider<br/>Muse / Mock]
    STT --> CTX[ContextManager<br/>rolling window + running summary + shown list]
    CTX --> TRG[TriggerEngine<br/>words / pause / min interval / one call at a time]
    TRG --> LLM[LLMProvider<br/>Muse / Mock]
    LLM --> PP[postProcess<br/>Zod · confidence · dedupe · anchor]
  end
  WSC <-->|binary audio ↑ · JSON events ↓| GW
  STT <-->|wss · realtime ASR| MVT[(Muse Voice Transcribe)]
  LLM -->|chat/completions · json_schema · web_search tool| MS[(Muse Wonder)]
  LLM -->|responses · built-in web_search| MS
  UI -->|/api/explain · /api/summary| GW
```

```
proass/
├── packages/shared/        # Zod schemas, WS protocol, trigger presets, demo script + player
├── apps/server/            # Node/TS backend (Docker; deployed on AWS ECS Fargate)
│   └── src/{stt,llm,context,trigger}/   # adapters + pipeline
├── apps/web/               # Next.js frontend (static export; deployed on AWS Amplify)
│   └── public/worklets/pcm-processor.js # 24 kHz resampler
├── infra/aws/backend.yml   # CloudFormation: ECS Fargate + HTTPS ALB
└── scripts/                # dev runner, AWS deploy, demo audio generator, end-to-end smoke test
```

### How the Muse APIs are used

| | Muse Voice Transcribe (`muse-voice-transcribe-1.0`) | Muse Wonder (`muse-wonder-1.0`) |
|---|---|---|
| Endpoint | `wss://api.meta.ai/v1/asr/realtime` | `POST https://api.meta.ai/v1/chat/completions` |
| Auth | `authorization.accessToken` in the first handshake frame | `Authorization: Bearer` header |
| Usage | `DIARIZATION` mode, `CUMULATIVE` partials, raw PCM16 24 kHz binary frames, `keywords` for jargon, `languageBias` from the language picker | Suggestions use `response_format: json_schema` (strict), `reasoning_effort: minimal`. Running summary, "tell me more" and the end-of-meeting summary (strict JSON schema) use `low`. |
| Web search | – | Insight calls offer a `web_search` function tool (`tool_choice: auto`, max `WEB_SEARCH_MAX` per call). The server runs each query through Muse's built-in `web_search` on the Responses API (`POST /v1/responses`) and returns the result as a `tool` message. |
| Resilience | Reconnects with backoff, replays the audio since the last final, rotates sessions before the 60-minute cap; gives up after 6 attempts and tells the browser | One retry on 429/5xx; never more than one insight call at a time |

### When does the assistant speak?

The `TriggerEngine` calls the LLM when **≥ 25 new words** have been finalized (debounced 600 ms), or after a **2 s pause** with at least 8 new words. Calls are spaced at least **9 s** apart and never overlap: speech that arrives while a call is running (a call with a web search takes 10–15 s) is picked up by the next call as soon as it finishes. The prompt contains the running summary, the last 2.5 minutes of transcript plus anything the summary doesn't cover yet (new lines marked `>>`), and the list of insights already shown. Lines stay marked new until a call that includes them succeeds. The results are validated with Zod. Items below the confidence threshold, duplicates of earlier cards, and a second card of the same type are dropped. A quote that cannot be found in the transcript lowers the item's confidence. Low, Medium and High presets live in `packages/shared/src/config.ts`; you can override any value with `TRIGGER_OVERRIDES`.

## Setup

Requirements: Node 20.12+ (tested on 22), npm 10.

```bash
npm install
cp apps/server/.env.example apps/server/.env   # set MUSE_API_KEY
cp apps/web/.env.example apps/web/.env.local   # optional, defaults to http://localhost:8787
npm run dev                                    # server :8787 + web :3000
```

Open http://localhost:3000 and press **Start**, or **Play the sample meeting**.

- If `MUSE_API_KEY` is missing, the server falls back to the **mock providers** automatically. You can also force them with `STT_PROVIDER=mock` / `LLM_PROVIDER=mock`. The mock STT replays the demo script, paced by the audio it receives.
- The server also reads a repo-root `.env`, and accepts the legacy variable name `muse_key`.

### Environment variables (server)

| Variable | Default | Purpose |
|---|---|---|
| `MUSE_API_KEY` | – | Muse Model API key (server only) |
| `STT_PROVIDER` / `LLM_PROVIDER` | `muse` if key set, else `mock` | Choose real or mock adapters |
| `MUSE_LLM_MODEL` | `muse-wonder-1.0` | Standard mode, so prompts are not used for training. `muse-spark-1.3` is a cheaper alternative (its `-contributor` variant shares prompts for training) |
| `MUSE_STT_MODE` | `DIARIZATION` | Or `ENDPOINTING` (no speaker labels) |
| `LLM_SUGGEST_REASONING_EFFORT` / `LLM_DEEP_REASONING_EFFORT` | `minimal` / `low` | Latency vs depth |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated web origins |
| `SESSION_SECRET` | random per boot | Set in production so tokens survive restarts |
| `TRUST_PROXY` | off | `1` behind a load balancer that appends the client IP to `X-Forwarded-For` (set in the AWS template). Off: limits use the socket address |
| `MAX_SESSIONS_PER_IP_PER_HOUR` | `60` | Session tokens per client IP per hour |
| `MAX_CONCURRENT_PER_IP` / `MAX_CONCURRENT` | `5` / `25` | Open meeting connections per client IP / in total |
| `MAX_EXPLAIN_PER_IP_PER_HOUR` / `MAX_SUMMARY_PER_IP_PER_HOUR` | `120` / `20` | "Tell me more" and end-of-meeting summary calls |
| `LLM_TIMEOUT_MS` | `25000` | Per LLM request (the end-of-meeting summary allows 90 s) |
| `MUSE_BASE_URL` / `MUSE_STT_URL` | `https://api.meta.ai/v1` / `wss://api.meta.ai/v1/asr/realtime` | API endpoints |
| `WEB_SEARCH_MAX` | `1` | Web searches per insight call. A searched card takes ~10 s instead of ~3 s. `0` turns the tool off |
| `TRIGGER_OVERRIDES` | – | JSON, e.g. `{"minWords":30,"minIntervalMs":12000}` |

### Scripts

```bash
npm run typecheck        # all workspaces
npm test                 # unit tests (trigger engine, filtering, text, script player)
npm run build            # server bundle + Next.js production build
npm run demo:audio       # regenerate demo audio + timeline (macOS `say`)
node scripts/smoke-test.mjs --speed 1   # stream the demo audio to a running server, print transcript + insights
```

## Deploy

**Server** needs long-lived WebSockets, so do not use serverless:

```bash
docker build -f apps/server/Dockerfile -t proass-server .
docker run -p 8787:8787 -e MUSE_API_KEY=... -e ALLOWED_ORIGINS=https://your-web.app -e SESSION_SECRET=... proass-server
```

**Render:** the repo also includes a `render.yaml` Blueprint. In the Render dashboard choose **New → Blueprint**, select this repo, then fill in `MUSE_API_KEY` and `ALLOWED_ORIGINS` (your web URL). `SESSION_SECRET` is generated automatically. The service runs on the free plan by default; free instances sleep when idle, so switch to a paid plan before a live demo. The live demo runs on AWS (below).

**AWS (ECS + Amplify), used for the live demo:** `infra/aws/backend.yml` runs the server on ECS Fargate (ARM64, 1 task) behind an HTTPS ALB on your own hostname, using a free ACM certificate. The Muse key and session secret live in Secrets Manager. The web app is a static export uploaded to Amplify Hosting.

```bash
DOMAIN=api.example.com scripts/deploy-aws.sh   # backend: reads MUSE_API_KEY from apps/server/.env; prints the DNS records to add
scripts/deploy-web-aws.sh                      # web: static export pointing at https://$DOMAIN, manual Amplify deploy
ALLOWED_ORIGINS=https://main.<appId>.amplifyapp.com scripts/deploy-aws.sh   # first time only: allow the web origin
```

Deploy from a clean commit (uncommitted server changes get a `-dirty-<time>` image tag), and not while someone is mid-meeting: a deploy closes open connections, and speaker labels restart from `A` after the reconnect. Both scripts default to `AWS_PROFILE=viettrans` and `AWS_REGION=ap-southeast-1`. On the first run, add the two CNAME records it prints at your DNS provider: one validates the certificate (keep it so the certificate auto-renews), and one points `DOMAIN` at the ALB. To remove everything, run `aws cloudformation delete-stack --stack-name proass-server`, then delete the ACM certificate, the `proass-server` ECR repo, the `proass/server` secret and the `proass-web` Amplify app.

On Railway or Fly.io, use the Dockerfile, or set the build command to `npm ci && npm run build -w @proass/server` and the start command to `node apps/server/dist/index.js`.

**Web**: on Vercel, set the root directory to `apps/web` and `NEXT_PUBLIC_SERVER_URL=https://your-server.example`. Mic and tab capture require HTTPS, and the server URL must also be HTTPS (WebSocket `wss://`).

## Demo tips

1. In **Settings → Audio source**, choose **Demo meeting**. Keep **Offline mode** off to show the live Muse pipeline; turn it on if the network is unreliable.
2. Insights to point out: the SOC 2 Type 1/2 definition, p95 explained (even though the STT heard "page 95"), the **GDPR fact check** (€20M / 4% vs the claimed €1M), decisions and action items.
3. To show live web search, switch to the microphone and say something time-sensitive, e.g. *"Bitcoin is trading at about fifty thousand dollars today."* The panel shows "Searching: …" and a fact-check card cites the current price about 10–15 s later.
4. Click an insight's quote to jump to the transcript, and use **Tell me more**.
5. Click **End & summarize**, then **Export .md**.

## Known limitations

- Speaker labels come from Muse diarization (`A`, `B`, …). They restart from `A` after a reconnect because a new STT session begins.
- Tab audio capture works in Chromium browsers only. System audio from desktop apps (e.g. the Zoom app) cannot be captured from a web page.
- Muse models always reason; end-to-end insight latency measured on the demo is about 5–7 s after the triggering sentence, and 10–15 s when the model runs a web search.
- Built-in web search returns no citations, so cards name the source only when the search text does.
