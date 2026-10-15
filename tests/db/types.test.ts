import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * src/types/database.ts must describe the schema the migrations build. scripts/db-types.ts
 * generates it from PGlite in the shape `supabase gen types` writes; this fails if a migration
 * changed without regenerating (`npm run db:types:local`).
 */
describe("src/types/database.ts", () => {
  it("matches the migrations", () => {
    let output = "";
    try {
      output = execFileSync(
        process.execPath,
        ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/db-types.ts", "--check"],
        { encoding: "utf8", stdio: "pipe" },
      );
    } catch (error) {
      const e = error as { stderr?: string; stdout?: string };
      throw new Error(`${e.stdout ?? ""}${e.stderr ?? ""}`);
    }
    expect(output).toContain("up to date");
  }, 90_000);
});
