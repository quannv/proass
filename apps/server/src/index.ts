import http from "node:http";
import { WebSocketServer } from "ws";
import { ExplainRequestSchema, SummaryRequestSchema } from "@proass/shared";
import type { ExplainResponse, SessionTokenResponse, SummaryResponse } from "@proass/shared";
import { allowRate, isOriginAllowed, issueToken, verifyToken } from "./auth";
import { config, providerInfo } from "./config";
import { llm } from "./llm";
import { Session, log } from "./session";

const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** About 100k tokens: far more than a long meeting, far less than the body limit. */
const MAX_SUMMARY_CHARS = 400_000;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Behind a proxy (TRUST_PROXY=1) the load balancer appends the address it saw to X-Forwarded-For, so only
 * the rightmost entry is trustworthy; anything to its left was sent by the client and can be forged.
 * Without a proxy the header is ignored entirely.
 */
function clientIp(req: http.IncomingMessage): string {
  const fwd = config.trustProxy ? req.headers["x-forwarded-for"] : undefined;
  return (Array.isArray(fwd) ? fwd.at(-1) : fwd)?.split(",").at(-1)?.trim() || req.socket.remoteAddress || "unknown";
}

function limit(req: http.IncomingMessage, kind: string, perHour: number): void {
  if (!allowRate(`${kind}:${clientIp(req)}`, perHour)) throw new HttpError(429, "Too many requests, try again later");
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function requireToken(req: http.IncomingMessage): void {
  const auth = req.headers.authorization;
  if (!verifyToken(auth?.startsWith("Bearer ") ? auth.slice(7) : null)) throw new HttpError(401, "Invalid or expired session token");
}

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<unknown> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") return { ok: true };

  if (req.method === "POST" && url.pathname === "/api/session") {
    if (!isOriginAllowed(req.headers.origin)) throw new HttpError(403, "Origin not allowed");
    if (!allowRate(`session:${clientIp(req)}`, config.maxSessionsPerIpPerHour)) throw new HttpError(429, "Too many sessions, try again later");
    const body: SessionTokenResponse = { ...issueToken(), providers: providerInfo };
    return body;
  }

  if (req.method === "POST" && url.pathname === "/api/explain") {
    requireToken(req);
    limit(req, "explain", config.maxExplainPerIpPerHour);
    const parsed = ExplainRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const { suggestion: s, context, language } = parsed.data;
    const text = await llm.explain(
      { type: s.type, title: s.title, body: s.body, trigger_quote: s.triggerQuote },
      context,
      language,
      abortOnClose(res),
    );
    return { text } satisfies ExplainResponse;
  }

  if (req.method === "POST" && url.pathname === "/api/summary") {
    requireToken(req);
    limit(req, "summary", config.maxSummaryPerIpPerHour);
    const parsed = SummaryRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    if (parsed.data.segments.reduce((n, x) => n + x.text.length, 0) > MAX_SUMMARY_CHARS) throw new HttpError(413, "Transcript too long to summarize");
    const summary: SummaryResponse = await llm.summarizeMeeting(parsed.data.segments, parsed.data.language, abortOnClose(res));
    return summary;
  }

  throw new HttpError(404, "Not found");
}

/** Abort the upstream LLM call if the browser goes away. */
function abortOnClose(res: http.ServerResponse): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  try {
    const body = await route(req, res);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 502;
    if (!(err instanceof HttpError)) log("http", `${req.url} failed: ${(err as Error).message}`);
    const message = err instanceof HttpError ? err.message : "Upstream AI service error";
    if (!res.headersSent) res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: message }));
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
const openByIp = new Map<string, number>();

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const reject = (status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  if (url.pathname !== "/ws" || !isOriginAllowed(req.headers.origin) || !verifyToken(url.searchParams.get("token"))) return reject("401 Unauthorized");
  // Caps how much STT/LLM quota one client (or everyone together) can burn at once.
  const ip = clientIp(req);
  if (wss.clients.size >= config.maxConcurrent || (openByIp.get(ip) ?? 0) >= config.maxConcurrentPerIp) return reject("429 Too Many Requests");
  wss.handleUpgrade(req, socket, head, (ws) => {
    openByIp.set(ip, (openByIp.get(ip) ?? 0) + 1);
    ws.on("close", () => {
      const n = (openByIp.get(ip) ?? 1) - 1;
      if (n > 0) openByIp.set(ip, n);
      else openByIp.delete(ip);
    });
    new Session(ws);
    // Heartbeat so proxies don't drop idle sockets and dead clients get cleaned up.
    let alive = true;
    ws.on("pong", () => (alive = true));
    const beat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 20_000);
    ws.on("close", () => clearInterval(beat));
  });
});

server.listen(config.port, () => {
  console.log(
    `ProActive Assistant server on :${config.port} (stt=${config.sttProvider}, llm=${config.llmProvider}, model=${config.llmModel}, origins=${config.allowedOrigins.join(",")})`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    wss.clients.forEach((c) => c.close(1001, "server shutting down"));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
