import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath (docs/PLAN.md 12.1)", () => {
  it.each([
    "//evil.example",
    "https://evil.example",
    "http://evil.example/app",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2Fevil.example",
    "/%2fevil.example",
    "%2F%2Fevil.example",
    "/%5Cevil.example",
    "/%5cevil.example",
    "/%252F%252Fevil.example",
    "/\t/evil.example",
    "/.//evil.example",
    "/..//evil.example",
    "/a/..//evil.example",
    "/%2e//evil.example",
    "/%2E%2E//evil.example",
    "/./%2Fevil.example",
    "/\n/evil.example",
    " /app",
    "javascript:alert(1)",
    "app/reply",
    "",
    "/",
  ])("falls back to /app for %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/app");
  });

  it.each([null, undefined])("falls back to /app for %s", (raw) => {
    expect(safeNextPath(raw)).toBe("/app");
  });

  it.each([
    ["/app/rivals?x=1", "/app/rivals?x=1"],
    ["/app/reply", "/app/reply"],
    ["/app/reply?view=saved&source=reddit#top", "/app/reply?view=saved&source=reddit#top"],
    ["/admin", "/admin"],
    ["/app/build?q=%2F", "/app/build?q=%2F"],
  ])("keeps the relative path %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it("uses the given fallback", () => {
    expect(safeNextPath("//evil.example", "/login")).toBe("/login");
  });

  it("refuses very long values", () => {
    expect(safeNextPath(`/app/${"a".repeat(3000)}`)).toBe("/app");
  });
});
