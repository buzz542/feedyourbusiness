import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/types/database.ts",
  ]),
  {
    // Fast feedback for the hosts gate: all outbound HTTP goes through safeFetch().
    // The authoritative check is tests/compliance/hosts.test.ts.
    files: ["src/**/*.{ts,tsx}", "emails/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Use safeFetch() from src/server/net/safe-fetch.ts. See CLAUDE.md non-negotiables.",
        },
      ],
    },
  },
  {
    // E2E specs import test from ./fixtures, which fails any request to a host other than localhost.
    files: ["tests/e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              message: "Import { test, expect } from ./fixtures (localhost-only requests).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/net/**"],
    rules: { "no-restricted-globals": "off" },
  },
]);
