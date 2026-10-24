import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDenylist } from "../../compliance/lib/denylist.mjs";
import { formatFindings, walk } from "../../compliance/lib/finding";
import {
  claimNumbers,
  copyGateFiles,
  findLogoFiles,
  runCopyGate,
  unscopedUiFiles,
} from "../../compliance/lib/scan-copy";

/**
 * CI gate `compliance:copy`: marketing pages and emails contain no em dashes, hype words,
 * competitor names or UK spellings; every number is in docs/claims.md; no platform logos.
 * App UI (src/app/(app), src/app/(admin), src/components) gets the same rules except numbers.
 * The gate's own wiring is tested on a planted tree in compliance/lib/scanners.test.ts.
 */
const deny = loadDenylist();

describe("compliance:copy", () => {
  it("has a claims register", () => {
    expect(existsSync("docs/claims.md")).toBe(true);
  });

  it("marketing pages, emails and app UI pass every copy rule for their scope", () => {
    const numbers = claimNumbers(readFileSync("docs/claims.md", "utf8"));
    expect(formatFindings(runCopyGate(deny, numbers))).toBe("");
  });

  it("actually scans something", () => {
    const files = copyGateFiles(deny);
    expect(files.some((f) => f.endsWith("page.tsx"))).toBe(true);
    expect(files.some((f) => f.startsWith("emails/"))).toBe(true);
    expect(files).toContain("src/app/layout.tsx");
  });

  it("every UI file in src/app and src/components is in a copy scope", () => {
    expect(unscopedUiFiles(deny)).toEqual([]);
  });

  it("no third-party platform logos in public/", () => {
    const findings = findLogoFiles(walk(deny.logos.publicDir), deny);
    expect(formatFindings(findings)).toBe("");
  });
});
