import { test as base, expect } from "@playwright/test";

/**
 * Every E2E page may talk to localhost only. Any other request is aborted and fails the test, so the
 * app is also proven to load no third-party fonts, scripts or analytics (docs/PLAN.md 9.3, 12.6).
 */
export const test = base.extend<{ offHostRequests: string[] }>({
  offHostRequests: [
    async ({ context }, use) => {
      const blocked: string[] = [];
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return route.continue();
        blocked.push(url.host);
        return route.abort("blockedbyclient");
      });
      await use(blocked);
      expect(blocked, "requests to hosts other than localhost").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
