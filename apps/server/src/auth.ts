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

/** Tiny in-memory per-IP limiter for token issuance. */
const issued = new Map<string, number[]>();
export function allowTokenFor(ip: string): boolean {
  const hourAgo = Date.now() - 3_600_000;
  const recent = (issued.get(ip) ?? []).filter((t) => t > hourAgo);
  if (recent.length >= config.maxSessionsPerIpPerHour) return false;
  recent.push(Date.now());
  issued.set(ip, recent);
  return true;
}
