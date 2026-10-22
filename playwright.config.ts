import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { assertLocalBaseUrl } from "./tests/e2e/base-url";
import { E2E_EMAIL } from "./tests/e2e/helpers/constants";

/**
 * Localhost E2E only. The guard refuses any other base URL before a browser starts. Claude Code
 * cloud sessions have Chromium preinstalled at /opt/pw-browsers; elsewhere Playwright's own is used.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = assertLocalBaseUrl(process.env.E2E_BASE_URL ?? `http://localhost:${port}`);
const preinstalled = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: existsSync(preinstalled) ? { executablePath: preinstalled } : {},
  },
  webServer: {
    command: `npm run build && npx next start -p ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      NEXT_PUBLIC_SITE_URL: baseURL,
      // The E2E user must pass the private beta check, and nobody else.
      SIGNUP_ALLOWLIST: E2E_EMAIL,
    },
  },
});
