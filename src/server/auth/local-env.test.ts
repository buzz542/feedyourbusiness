import { describe, expect, it } from "vitest";
import { isLocalDevServer } from "./local-env";

describe("isLocalDevServer", () => {
  it("is true only off Vercel with a localhost site URL", () => {
    expect(isLocalDevServer({ NEXT_PUBLIC_SITE_URL: "http://localhost:3210" })).toBe(true);
    expect(isLocalDevServer({ NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000" })).toBe(true);
  });

  it.each([
    [{ NEXT_PUBLIC_SITE_URL: "https://askedfor.app" }],
    [{ NEXT_PUBLIC_SITE_URL: "http://localhost:3000", VERCEL_ENV: "production" }],
    [{ NEXT_PUBLIC_SITE_URL: "http://localhost:3000", VERCEL_ENV: "preview" }],
    [{ NEXT_PUBLIC_SITE_URL: "http://localhost.evil.example" }],
    [{ NEXT_PUBLIC_SITE_URL: "not a url" }],
    [{}],
  ])("is false for %j", (env) => {
    expect(isLocalDevServer(env)).toBe(false);
  });
});
