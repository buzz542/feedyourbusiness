import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** The eval runner only: never part of `npm test` or CI. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("../src"),
      "server-only": fromRoot("../tests/stubs/server-only.ts"),
    },
  },
  test: { environment: "node", include: ["eval/**/*.eval.ts"], root: fromRoot("..") },
});
