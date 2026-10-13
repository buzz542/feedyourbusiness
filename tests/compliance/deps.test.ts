import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDenylist } from "../../compliance/lib/denylist.mjs";
import { formatFindings } from "../../compliance/lib/finding";
import { findBlockedPackages } from "../../compliance/lib/scan-deps";

/** CI gate `compliance:deps`: no scraping SDK or scraping service anywhere in the dependency tree. */
describe("compliance:deps", () => {
  it("has a lockfile to check", () => {
    expect(existsSync("package-lock.json")).toBe(true);
  });

  it("no denylisted package is in package.json or the lockfile, transitive included", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(formatFindings(findBlockedPackages(lock, pkg, loadDenylist()))).toBe("");
  });
});
