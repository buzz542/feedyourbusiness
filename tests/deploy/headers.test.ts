import { describe, expect, it } from "vitest";
import config from "../../next.config";

/**
 * Security headers (docs/PLAN.md 12.8) on every route, `/` and `/app` included. Verified on a
 * production build with curl as well (docs/TASKS.md, M9).
 */

const REQUIRED: Record<string, RegExp> = {
  "X-Content-Type-Options": /^nosniff$/,
  "Referrer-Policy": /^strict-origin-when-cross-origin$/,
  "X-Frame-Options": /^DENY$/,
  "Content-Security-Policy": /(^|;\s*)frame-ancestors 'none'(;|$)/,
  "Strict-Transport-Security": /^max-age=(\d{8,})(; includeSubDomains)?$/,
  "Permissions-Policy": /camera=\(\).*microphone=\(\).*geolocation=\(\)/,
};

const matches = (source: string, path: string) =>
  source === "/:path*" ||
  source === path ||
  (source.endsWith("/:path*") && path.startsWith(source.slice(0, -7)));

describe("security headers", () => {
  it.each(["/", "/app", "/app/reply", "/pricing", "/api/health"])(
    "are all set on %s",
    async (path) => {
      const rules = (await config.headers!()).filter((r) => matches(r.source, path));
      const headers = new Map(
        rules.flatMap((r) => r.headers.map((h) => [h.key, h.value] as const)),
      );
      for (const [key, pattern] of Object.entries(REQUIRED))
        expect(headers.get(key), key).toMatch(pattern);
    },
  );

  it("asks HSTS for at least a year", async () => {
    const [rule] = await config.headers!();
    const hsts = rule!.headers.find((h) => h.key === "Strict-Transport-Security")!.value;
    expect(Number(/max-age=(\d+)/.exec(hsts)?.[1])).toBeGreaterThanOrEqual(31_536_000);
  });

  it("does not send the X-Powered-By header", () => {
    expect(config.poweredByHeader).toBe(false);
  });
});
