import { test as base, expect } from "@playwright/test";
import { isLocalUrl } from "./guard";

/**
 * The E2E `test`: every request and WebSocket the browser opens must stay on localhost. Anything
 * else is aborted and fails the test, so E2E can never touch a deployment or a third-party site.
 * Redirect hops are recorded too (route handlers only see the first URL), and playwright.config.ts
 * points the browser at a dead proxy that Chromium skips for loopback, so an off-site hop can never
 * connect. The guard is automatic; tests/e2e/specs-use-guard.test.ts checks every spec imports
 * this `test`, and tests/e2e/guard-self-test.spec.ts proves it fails a test that leaves localhost.
 */
export const test = base.extend<{ offSiteRequests: string[]; expectedOffSite: string[] }>({
  /** Only the guard's own self-test sets this, to prove the guard records exactly these hosts. */
  expectedOffSite: [[], { option: true }],
  offSiteRequests: [
    async ({ context, expectedOffSite }, provide) => {
      const blocked: string[] = [];
      const offSite = (raw: string) =>
        !raw.startsWith("data:") && !raw.startsWith("blob:") && !isLocalUrl(new URL(raw).origin);
      // Every request, redirect hops included.
      context.on("request", (request) => {
        if (offSite(request.url())) blocked.push(new URL(request.url()).host);
      });
      await context.route(
        (url) => !isLocalUrl(url.origin) && !url.protocol.startsWith("data"),
        (route) => route.abort("blockedbyclient"),
      );
      await context.routeWebSocket(
        (url) => !isLocalUrl(url.origin.replace(/^ws/, "http")),
        async (ws) => {
          blocked.push(new URL(ws.url()).host);
          await ws.close();
        },
      );
      await provide(blocked);
      expect([...new Set(blocked)], "browser requests that left localhost").toEqual(
        expectedOffSite,
      );
    },
    { auto: true },
  ],
});

export { expect };
