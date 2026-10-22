import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it.each([
    "//evil.example",
    "//evil.example/app",
    "https://evil.example",
    "http://evil.example/app",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2Fevil.example",
    "/%5Cevil.example",
    "%2F%2Fevil.example",
    "/%252F%252Fevil.example",
    "javascript:alert(1)",
    "/app\n/evil",
    "/app\t",
    " /app",
    "app",
    "",
    "/",
    "/login",
    "/auth/callback",
    "/api/billing/cancel",
    "/appx",
    "/app/../login",
    "/app/%2e%2e/login",
  ])("falls back to /app for %j", (input) => {
    expect(safeNextPath(input)).toBe("/app");
  });

  it.each([null, undefined])("falls back to /app for %s", (input) => {
    expect(safeNextPath(input)).toBe("/app");
  });

  it.each([
    "/app",
    "/app/rivals?x=1",
    "/app/reply?view=saved&source=reddit",
    "/admin",
    "/admin/removals",
  ])("keeps %s", (input) => {
    expect(safeNextPath(input)).toBe(input);
  });
});
