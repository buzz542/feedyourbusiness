import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDenylist } from "../../compliance/lib/denylist.mjs";
import { formatFindings, isTestFile, walk } from "../../compliance/lib/finding";
import {
  checkCopy,
  claimNumbers,
  extractCopy,
  findLogoFiles,
} from "../../compliance/lib/scan-copy";

/**
 * CI gate `compliance:copy`: marketing pages and emails contain no em dashes, hype words,
 * competitor names or UK spellings; every number is in docs/claims.md; no platform logos.
 */
const deny = loadDenylist();

describe("compliance:copy", () => {
  it("has a claims register", () => {
    expect(existsSync("docs/claims.md")).toBe(true);
  });

  it("marketing pages and emails pass every copy rule", () => {
    const numbers = claimNumbers(readFileSync("docs/claims.md", "utf8"));
    const files = deny.copy.scanRoots
      .flatMap((root) => walk(root))
      .filter((f) => !isTestFile(f) && /\.(tsx?|mdx?)$/.test(f));

    const findings = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const items = /\.mdx?$/.test(file)
        ? source.split("\n").map((text, i) => ({ text, line: i + 1 }))
        : extractCopy(source, file);
      return checkCopy(items, file, deny, numbers);
    });
    expect(formatFindings(findings)).toBe("");
  });

  it("actually scans something", () => {
    const files = deny.copy.scanRoots.flatMap((root) => walk(root)).filter((f) => !isTestFile(f));
    expect(files.some((f) => f.endsWith("page.tsx"))).toBe(true);
    expect(files.some((f) => f.startsWith("emails/"))).toBe(true);
  });

  it("no third-party platform logos in public/", () => {
    const findings = findLogoFiles(walk(deny.logos.publicDir), deny);
    expect(formatFindings(findings)).toBe("");
  });
});
