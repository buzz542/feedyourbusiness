import { describe, expect, it } from "vitest";
import config from "../../next.config";

/** Security headers (docs/PLAN.md 12.8) on / and /app: one rule covers every path. */
describe("security headers", () => {
  it("apply to every path, including / and /app", async () => {
    const rules = await config.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    const headers = Object.fromEntries(all!.headers.map((h) => [h.key.toLowerCase(), h.value]));
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["strict-transport-security"]).toMatch(/max-age=\d{8,}/);
  });

  it("does not advertise the framework", () => {
    expect(config.poweredByHeader).toBe(false);
  });
});
