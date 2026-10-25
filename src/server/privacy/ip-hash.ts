import { createHmac } from "node:crypto";

/**
 * IP hashes for rate limits (docs/PLAN.md 12.5): HMAC(APP_HMAC_SECRET, "<UTC day>:<ip>"), so they
 * change daily and the IP itself is never stored.
 */
export function ipHash(secret: string | undefined, ip: string, now: Date): string {
  if (!secret || secret.length < 32)
    throw new Error("APP_HMAC_SECRET must be at least 32 characters");
  return createHmac("sha256", secret)
    .update(`${now.toISOString().slice(0, 10)}:${ip.trim().toLowerCase()}`)
    .digest("hex");
}

/** The client IP Vercel reports (first x-forwarded-for entry), or "unknown". */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
