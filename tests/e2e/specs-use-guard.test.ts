import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every E2E spec takes `test` from ./support/test, which carries the localhost-only guard. */
const specs = readdirSync("tests/e2e", { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".spec.ts"))
  .map((f) => `tests/e2e/${f}`);

export function usesGuardedTest(source: string): boolean {
  const importsGuard =
    /from\s+"\.\/support\/test"/.test(source) || /from\s+"(\.\.\/)+support\/test"/.test(source);
  const importsRawTest = /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*"@playwright\/test"/.test(
    source,
  );
  return importsGuard && !importsRawTest;
}

describe("E2E specs", () => {
  it("exist", () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  it.each(specs)("%s uses the guarded test", (file) => {
    expect(usesGuardedTest(readFileSync(file, "utf8"))).toBe(true);
  });

  it("catches a spec that imports test straight from Playwright (planted)", () => {
    expect(usesGuardedTest(`import { test, expect } from "@playwright/test";`)).toBe(false);
    expect(usesGuardedTest(`import { expect } from "@playwright/test";`)).toBe(false);
    expect(
      usesGuardedTest(
        `import { expect, test } from "./support/test";\nimport { test as t } from "@playwright/test";`,
      ),
    ).toBe(false);
  });
});
