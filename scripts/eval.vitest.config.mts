import { defineConfig } from "vitest/config";
import base from "../vitest.config.mjs";

/** Runs only the founder's classifier eval (scripts/eval-classifier.ts). */
export default defineConfig({
  ...base,
  test: { ...base.test, include: ["scripts/eval-classifier.run.ts"] },
});
