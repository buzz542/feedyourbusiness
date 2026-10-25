import { describe, expect, it } from "vitest";
import { safeBack } from "./safe-back";

describe("safeBack", () => {
  it.each([
    "/app/reply",
    "/app/reply?view=all&min=60",
    "/app/rivals?rival=discovered",
    "/app/build",
    "/app/reply?q=note*",
  ])("keeps %s", (url) => {
    expect(safeBack(url)).toBe(url);
  });

  it.each([
    "//evil.example",
    "https://evil.example/app/reply",
    "/app/replyx",
    "/app/reply/../../login",
    "/app/reply?x=<script>",
    "/app/settings",
    "/\\evil.example",
    null,
    42,
  ])("falls back for %j", (url) => {
    expect(safeBack(url)).toBe("/app/reply");
  });
});
