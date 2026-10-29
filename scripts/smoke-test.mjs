// End-to-end smoke test: streams the demo meeting audio to a running server like the browser does.
// Usage: node scripts/smoke-test.mjs [--server http://localhost:8787] [--speed 1] [--seconds 60]
// Requires scripts/.demo-tmp/meeting.wav (run `npm run demo:audio`).
import { readFileSync } from "node:fs";
import WebSocket from "ws";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const server = args.server || "http://localhost:8787";
const speed = Number(args.speed || 1);
const seconds = Number(args.seconds || 9999);
const origin = args.origin || "http://localhost:3000";

const pcm = readFileSync(new URL("./.demo-tmp/meeting.wav", import.meta.url)).subarray(44, 44 + seconds * 48_000);
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);

const res = await fetch(`${server}/api/session`, { method: "POST", headers: { Origin: origin } });
if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
const { token, providers } = await res.json();
log("providers", providers);

const ws = new WebSocket(`${server.replace(/^http/, "ws")}/ws?token=${token}`, { origin });
const stats = { finals: 0, suggestions: 0 };
let lastFinalAt = 0;
ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "start",
    settings: { frequency: "medium", enabledTypes: ["definition", "background", "fact_check", "question_to_ask", "action_item", "decision", "related_idea"], outputLanguage: "auto", spokenLanguages: ["English"], keywords: ["SOC 2", "p95", "RAG", "GDPR", "DPA"] },
    resume: { elapsedMs: 0, segments: [], summary: "", shown: [] },
  }));
});
ws.on("message", (data) => {
  const m = JSON.parse(data.toString());
  if (m.type === "ready") {
    log("ready", m.sessionId);
    let off = 0;
    const step = 4800; // 100 ms of audio
    const iv = setInterval(() => {
      if (off >= pcm.length) {
        clearInterval(iv);
        log("audio done; stopping in 6 s");
        setTimeout(() => ws.send(JSON.stringify({ type: "stop" })), 6000);
        return;
      }
      ws.send(pcm.subarray(off, off + step));
      off += step;
    }, 100 / speed);
  } else if (m.type === "final") {
    stats.finals++;
    lastFinalAt = Date.now();
    log(`FINAL [${m.segment.speaker ?? "-"}] ${m.segment.text}`);
  } else if (m.type === "suggestions") {
    for (const s of m.items) {
      stats.suggestions++;
      log(`  ★ ${s.type} (${s.confidence.toFixed(2)}) "${s.title}" +${((Date.now() - lastFinalAt) / 1000).toFixed(1)}s after last final, anchored=${!!s.segmentId}`);
    }
  } else if (m.type === "thinking" || m.type === "summary_update" || m.type === "error" || m.type === "ended") {
    log(m.type, m.active ?? m.message ?? "");
  }
});
ws.on("close", (code) => {
  log("closed", code, stats);
  process.exit(stats.finals > 0 ? 0 : 1);
});
