import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      // The real package throws outside a React Server Components build.
      "server-only": fromRoot("./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "tests/**/*.test.ts",
      "compliance/**/*.test.ts",
      "emails/**/*.test.ts",
    ],
    testTimeout: 30_000,
    // PGlite boots Postgres in WASM in beforeAll; with many workers starting at once it can exceed 10s.
    hookTimeout: 90_000,
  },
});
