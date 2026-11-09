import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** `npm run capture:brightdata` only (F8, by the founder): never part of `npm test` or CI. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("../src"),
      "server-only": fromRoot("../tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["scripts/**/*.live.ts"],
    root: fromRoot(".."),
    testTimeout: 40 * 60_000,
  },
});
