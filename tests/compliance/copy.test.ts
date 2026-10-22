import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDenylist } from "../../compliance/lib/denylist.mjs";
import { formatFindings, isTestFile, walk } from "../../compliance/lib/finding";
import { claimNumbers, findLogoFiles, scanCopyRoots } from "../../compliance/lib/scan-copy";

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
    expect(formatFindings(scanCopyRoots(deny.copy.scanRoots, deny, numbers))).toBe("");
  });

  it("app UI passes every copy rule except the claims-number rule", () => {
    expect(formatFindings(scanCopyRoots(deny.copy.appScanRoots, deny, null))).toBe("");
  });

  it("scans the app UI folders", () => {
    expect(deny.copy.appScanRoots).toEqual(
      expect.arrayContaining(["src/app/(app)", "src/app/(admin)", "src/components"]),
    );
  });

  it("catches violations planted in an app file, and not its numbers", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "copy-gate-"));
    try {
      mkdirSync(path.join(dir, "src/app/(app)/app"), { recursive: true });
      writeFileSync(
        path.join(dir, "src/app/(app)/app/page.tsx"),
        [
          "export default function Page() {",
          "  return (",
          "    <main>",
          "      <h1>Your favourite posts \u2014 all 200 of them</h1>",
          "      <p>Supercharge replies, unlike Syften. Match 87.</p>",
          "    </main>",
          "  );",
          "}",
        ].join("\n"),
      );
      const findings = scanCopyRoots(deny.copy.appScanRoots, deny, null, dir);
      expect(findings.map((f) => f.rule).sort()).toEqual([
        "banned-phrase",
        "competitor-name",
        "em-dash",
        "uk-spelling",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
