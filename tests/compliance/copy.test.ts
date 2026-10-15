import { existsSync, readdirSync, readFileSync } from "node:fs";
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
 * App UI (signed-in app, admin, shared components) gets the same rules except the numbers rule:
 * numbers there are live data, not public claims (docs/PLAN.md 3.2).
 */
const deny = loadDenylist();

const sourceFiles = (roots: readonly string[]) =>
  roots.flatMap((root) => walk(root)).filter((f) => !isTestFile(f) && /\.(tsx?|mdx?)$/.test(f));

/** Files directly in src/app (root layout metadata, not-found and error pages) are public copy. */
const appRootFiles = () =>
  readdirSync("src/app", { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => `src/app/${e.name}`);

function scanFiles(files: readonly string[], options: { numbers: boolean }) {
  const numbers = claimNumbers(readFileSync("docs/claims.md", "utf8"));
  return files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const items = /\.mdx?$/.test(file)
      ? source.split("\n").map((text, i) => ({ text, line: i + 1 }))
      : extractCopy(source, file);
    return checkCopy(items, file, deny, numbers, options);
  });
}

describe("compliance:copy", () => {
  it("has a claims register", () => {
    expect(existsSync("docs/claims.md")).toBe(true);
  });

  it("marketing pages, emails and root app files pass every copy rule", () => {
    const files = [...sourceFiles(deny.copy.scanRoots), ...appRootFiles()];
    expect(files).toContain("src/app/layout.tsx");
    expect(formatFindings(scanFiles(files, { numbers: true }))).toBe("");
  });

  it("shared UI components keep the numbers rule: they also render on public pages", () => {
    expect(deny.copy.scanRoots).toContain("src/components/ui");
    expect(deny.copy.appScanRoots).not.toContain("src/components");
    expect(deny.copy.appScanRoots).not.toContain("src/components/ui");
  });

  it("app UI passes every copy rule except the numbers rule", () => {
    expect(deny.copy.appScanRoots).toEqual(
      expect.arrayContaining(["src/app/(app)", "src/app/(admin)", "src/components/app"]),
    );
    expect(formatFindings(scanFiles(sourceFiles(deny.copy.appScanRoots), { numbers: false }))).toBe(
      "",
    );
  });

  it("catches planted violations in an app file", () => {
    const rules = scanFiles(["tests/fixtures/copy/app-violations.tsx"], { numbers: false }).map(
      (f) => f.rule,
    );
    expect(rules).toEqual(
      expect.arrayContaining(["em-dash", "banned-phrase", "uk-spelling", "competitor-name"]),
    );
  });

  it("does not flag live numbers in app copy, but would in marketing copy", () => {
    const file = "tests/fixtures/copy/app-numbers.tsx";
    expect(scanFiles([file], { numbers: false })).toEqual([]);
    expect(scanFiles([file], { numbers: true }).map((f) => f.rule)).toContain("unsourced-number");
  });

  it("actually scans the app UI too", () => {
    const appFiles = sourceFiles(deny.copy.appScanRoots);
    expect(appFiles).toContain("src/app/(app)/app/layout.tsx");
    expect(appFiles.some((f) => f.startsWith("src/components/app/"))).toBe(true);
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
