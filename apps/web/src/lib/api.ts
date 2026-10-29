import type {
  ExplainRequest,
  ExplainResponse,
  SessionTokenResponse,
  SummaryRequest,
  SummaryResponse,
} from "@proass/shared";

export const SERVER_URL = (process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8787").replace(/\/$/, "");
export const WS_URL = SERVER_URL.replace(/^http/, "ws");

let cached: SessionTokenResponse | null = null;

/** Short-lived token from our backend; reused until a minute before expiry. */
export async function getSession(force = false): Promise<SessionTokenResponse> {
  if (!force && cached && cached.expiresAt - Date.now() > 60_000) return cached;
  const res = await fetch(`${SERVER_URL}/api/session`, { method: "POST" }).catch(() => {
    throw new Error(`Can't reach the assistant server at ${SERVER_URL}.`);
  });
  if (!res.ok) throw new Error(await errorText(res));
  cached = (await res.json()) as SessionTokenResponse;
  return cached;
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const { token } = await getSession();
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as T;
}

export const explain = (req: ExplainRequest, signal?: AbortSignal) => post<ExplainResponse>("/api/explain", req, signal);
export const summarize = (req: SummaryRequest, signal?: AbortSignal) => post<SummaryResponse>("/api/summary", req, signal);

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || `Server error (${res.status})`;
  } catch {
    return `Server error (${res.status})`;
  }
}
