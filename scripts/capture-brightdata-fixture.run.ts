import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { it } from "vitest";
import { captureBrightdataFixture } from "./capture-brightdata-fixture";

/** `npm run capture:brightdata` (founder only, F8). Real network, real token, about a cent. */
it(
  "captures one Bright Data snapshot and checks it against the schema",
  async () => {
    const passed = await captureBrightdataFixture({
      env: process.env,
      fetchImpl: globalThis.fetch,
      now: () => new Date(),
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      writeFile: (path, text) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      },
      removeFile: (path) => rmSync(path, { force: true }),
      log: (line) => console.log(line),
    });
    if (!passed) throw new Error("The capture did not pass; see the lines above.");
  },
  15 * 60_000,
);
