import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Admin (docs/PLAN.md 4.8): the proxy 404s non-admins (route-guard.test.ts), and every admin page
 * and server action checks for itself, since a server action is a POST anyone can send.
 */

const root = path.resolve(import.meta.dirname, "../../app/(admin)/admin");

describe("admin surface", () => {
  it("the page calls requireAdmin before reading anything", () => {
    const page = readFileSync(path.join(root, "page.tsx"), "utf8");
    const body = page.slice(page.indexOf("export default async function"));
    expect(body.indexOf("await requireAdmin()")).toBeGreaterThan(-1);
    expect(body.indexOf("await requireAdmin()")).toBeLessThan(body.indexOf("listOpenRemovals"));
  });

  it("every exported server action calls requireAdmin first", () => {
    const actions = readFileSync(path.join(root, "actions.ts"), "utf8");
    const exported = actions.split(/(?=export async function )/).slice(1);
    expect(exported.length).toBeGreaterThanOrEqual(2);
    for (const fn of exported) {
      const firstAwait = fn.indexOf("await ");
      expect(fn.slice(firstAwait).startsWith("await requireAdmin()"), fn.slice(0, 60)).toBe(true);
    }
  });
});
