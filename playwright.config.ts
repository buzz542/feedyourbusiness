import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";
import { assertDevSupabase, assertLocalBaseUrl } from "./tests/e2e/support/guard";

/**
 * Localhost E2E only (docs/PLAN.md 5.3). The base URL guard refuses anything but localhost, so the
 * suite can never drive a deployment or a third-party site. CI does not run it: it needs the
 * development project's keys (F12). Run with `npm run test:e2e`.
 */

// Read .env.local exactly as `next dev` will, so the guard sees the project the server uses.
loadEnvConfig(process.cwd());

const PORT = 3210;
const baseURL = assertLocalBaseUrl(`http://localhost:${PORT}`).origin;
// The dev server and every test use this project: never production, whatever the env says.
if (process.env.NEXT_PUBLIC_SUPABASE_URL) assertDevSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL);

/** The one address the sign-in test uses; it is added to the dev server's allowlist. */
export const E2E_EMAIL = "e2e-signin@example.test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `${baseURL}/login`,
    // Always our own server, started with the env below; never whatever already holds the port.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SITE_URL: baseURL,
      NEXT_TELEMETRY_DISABLED: "1",
      // A fake model and site for onboarding; honored only on a local run (fake-services.ts).
      E2E_FAKE_SERVICES: "1",
      SIGNUP_ALLOWLIST: [process.env.SIGNUP_ALLOWLIST, E2E_EMAIL].filter(Boolean).join(","),
    },
  },
});
