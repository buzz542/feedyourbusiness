import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

/** The `next` parameter is a relative path into the app, never another site (docs/PLAN.md 12.1). */
describe("safeNextPath", () => {
  it.each([
    "//evil.example",
    "///evil.example",
    "https://evil.example",
    "http://evil.example/app",
    "/\\evil.example",
    "\\\\evil.example",
    "/app\\..\\evil",
    "%2F%2Fevil.example",
    "/%2F%2Fevil.example",
    "/%2f%2fevil.example",
    "%2F%5Cevil.example",
    "/%5Cevil.example",
    "/%252F%252Fevil.example",
    "javascript:alert(1)",
    "data:text/html,hi",
    " /app",
    "/app\n/evil",
    "/app\t",
    "app/rivals",
    "",
    "/",
    "/pricing",
    "/api/billing/cancel",
    "/appx",
    "/%",
    `/app/${"a".repeat(600)}`,
  ])("falls back to /app for %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/app");
  });

  it.each([null, undefined])("falls back for %s", (raw) => {
    expect(safeNextPath(raw)).toBe("/app");
  });

  it.each([
    ["/app", "/app"],
    ["/app/rivals?x=1", "/app/rivals?x=1"],
    ["/app/reply?view=saved&source=hackernews", "/app/reply?view=saved&source=hackernews"],
    ["/app/settings#email", "/app/settings#email"],
    ["/admin", "/admin"],
    ["/admin/removals", "/admin/removals"],
  ])("keeps %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it("normalizes dot segments and still requires the result to be inside the app", () => {
    expect(safeNextPath("/app/../pricing")).toBe("/app");
    expect(safeNextPath("/app/./rivals")).toBe("/app/rivals");
  });
});
