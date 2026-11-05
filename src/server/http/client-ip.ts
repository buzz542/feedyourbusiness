/**
 * The visitor's IP for rate limits only (docs/PLAN.md 12.5, 12.7); it is hashed with the UTC day at
 * once and never stored. On Vercel, x-real-ip and x-forwarded-for are set by the platform (it
 * overwrites what a client sends), so the first is trusted; anything else counts as one bucket.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 64) : "unknown";
}
