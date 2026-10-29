import http from "node:http";
import { WebSocketServer } from "ws";
import { ExplainRequestSchema, SummaryRequestSchema } from "@proass/shared";
import type { ExplainResponse, SessionTokenResponse, SummaryResponse } from "@proass/shared";
import { allowTokenFor, isOriginAllowed, issueToken, verifyToken } from "./auth";
import { config } from "./config";
import { llm } from "./llm";
import { Session, log } from "./session";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function clientIp(req: http.IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  return (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
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
    if (!allowTokenFor(clientIp(req))) throw new HttpError(429, "Too many sessions, try again later");
    const body: SessionTokenResponse = { ...issueToken(), providers: { stt: config.sttProvider, llm: config.llmProvider } };
    return body;
  }

  if (req.method === "POST" && url.pathname === "/api/explain") {
    requireToken(req);
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
    const parsed = SummaryRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
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

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws" || !isOriginAllowed(req.headers.origin) || !verifyToken(url.searchParams.get("token"))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
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
