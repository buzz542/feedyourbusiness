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
    files: ["src/server/net/**"],
    rules: { "no-restricted-globals": "off" },
  },
]);
