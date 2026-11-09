import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { captureBrightdataFixture } from "./capture-brightdata-fixture";

/**
 * The F8 capture, run by the founder on their own machine (it costs a few cents):
 *   SOURCE_REDDIT_ENABLED=true CAPTURE_LIVE=1 npm run capture:brightdata
 * See scripts/capture-brightdata-fixture.ts. Skipped unless CAPTURE_LIVE=1.
 */
// Loaded first, so CAPTURE_LIVE and the keys may live there too. Shell values win over the file.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

describe("Bright Data capture (live)", () => {
  const live = process.env.CAPTURE_LIVE === "1";
  it.runIf(live)(
    "checks one real snapshot against the Reddit schema, then deletes it",
    async () => {
      const result = await captureBrightdataFixture({
        root: process.cwd(),
        env: process.env,
        fs: {
          mkdir: async (path) => void (await mkdir(path, { recursive: true })),
          writeFile: (path, text) => writeFile(path, text, { flag: "wx" }),
          readFile: (path) => readFile(path, "utf8"),
          rm: (path) => rm(path),
        },
        print: (line) => console.log(line),
        sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
        now: () => new Date(),
        ...(process.env.CAPTURE_KEYWORD ? { keyword: process.env.CAPTURE_KEYWORD } : {}),
      });
      expect(result.pass).toBe(true);
    },
  );
  it.skipIf(live)("is skipped unless CAPTURE_LIVE=1 (it calls the live vendor API)", () => {});
});
