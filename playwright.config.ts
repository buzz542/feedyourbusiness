import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";
import { allE2EEmails, E2E_PROJECTS } from "./tests/e2e/support/emails";
import { assertLocalBaseUrl } from "./tests/e2e/support/guard";

/**
 * Localhost E2E only (docs/PLAN.md 2.1.6). Chromium is preinstalled in Claude Code cloud sessions
 * (PLAYWRIGHT_BROWSERS_PATH); this Playwright version matches it, so nothing is downloaded.
 */
// The same .env.local the dev server reads, so the sign-in helper sees the development keys.
// Development mode, as `next dev` loads them (.env.development.local, .env.local, .env).
loadEnvConfig(process.cwd(), true);

const baseURL = assertLocalBaseUrl(process.env.E2E_BASE_URL ?? "http://localhost:3000");
const port = new URL(baseURL).port || "3000";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    // A dead proxy for everything except loopback, so an off-site request can never connect.
    proxy: { server: "http://127.0.0.1:9", bypass: "localhost,127.0.0.1,[::1]" },
  },
  // One project per entry in E2E_PROJECTS, so each has its own allowlisted test email.
  projects: E2E_PROJECTS.map((name) => ({
    name,
    use: {
      ...devices["Desktop Chrome"],
      ...(name === "mobile" ? { viewport: { width: 375, height: 812 } } : {}),
    },
  })),
  webServer: {
    command: `npx next dev --port ${port}`,
    url: baseURL,
    // Never reuse a running server: its environment would lack the E2E allowlist entries.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SITE_URL: baseURL,
      SIGNUP_ALLOWLIST: [process.env.SIGNUP_ALLOWLIST, ...allE2EEmails()].filter(Boolean).join(","),
    },
  },
});
