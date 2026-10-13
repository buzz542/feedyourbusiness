import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. If the secret is not configured the
 * route stays closed: an unset secret must never mean "open to everyone".
 */
export function isCronAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
