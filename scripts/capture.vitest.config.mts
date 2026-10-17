import { defineConfig } from "vitest/config";
import base from "../vitest.config.mjs";

/** Runs only the founder's Bright Data capture (scripts/capture-brightdata-fixture.ts). */
export default defineConfig({
  ...base,
  test: { ...base.test, include: ["scripts/capture-brightdata-fixture.run.ts"] },
});
