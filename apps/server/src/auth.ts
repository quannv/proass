import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config";

/** Short-lived HMAC token: `<base64url payload>.<base64url signature>`. No server-side storage needed. */
export function issueToken(): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + config.tokenTtlMs;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt, n: randomBytes(8).toString("hex") })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifyToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp: number };
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (config.allowedOrigins.includes("*")) return true;
  return !!origin && config.allowedOrigins.includes(origin);
}

/** Tiny in-memory sliding-window limiter, keyed by e.g. `session:<ip>`. */
const hits = new Map<string, number[]>();
export function allowRate(key: string, perHour: number): boolean {
  const hourAgo = Date.now() - 3_600_000;
  const recent = (hits.get(key) ?? []).filter((t) => t > hourAgo);
  if (recent.length >= perHour) return false;
  recent.push(Date.now());
  hits.set(key, recent);
  return true;
}
// Forget idle keys so the map can't grow without bound.
setInterval(() => {
  const hourAgo = Date.now() - 3_600_000;
  for (const [key, times] of hits) if (!times.some((t) => t > hourAgo)) hits.delete(key);
}, 10 * 60_000).unref();
