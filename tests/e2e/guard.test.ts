import { describe, expect, it } from "vitest";
import { e2eConfig } from "./support/auth";
import { assertLocalBaseUrl } from "./support/guard";

/** E2E runs against localhost only (docs/PLAN.md 2.1.6): never a deployment, never a third party. */
describe("assertLocalBaseUrl", () => {
  it.each([
    "http://localhost:3000",
    "http://localhost:3000/",
    "http://127.0.0.1:3100",
    "http://[::1]:3000",
    "https://localhost:3443",
  ])("accepts %s", (url) => {
    expect(assertLocalBaseUrl(url)).toBe(new URL(url).origin);
  });

  it.each([
    "https://askedfor.app",
    "https://askedfor-git-main-buzz542s-projects.vercel.app",
    "https://www.reddit.com",
    "http://localhost.evil.example:3000",
    "http://evil.example/localhost",
    "http://localhost@evil.example",
    "http://10.0.0.5:3000",
    "http://192.168.1.10:3000",
    "ftp://localhost",
    "file:///etc/passwd",
    "not a url",
    "",
  ])("refuses %s", (url) => {
    expect(() => assertLocalBaseUrl(url)).toThrow(/localhost/);
  });
});

describe("e2eConfig", () => {
  const keys = { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk" };

  it("is null without keys, so sign-in E2E is skipped", () => {
    expect(e2eConfig({})).toBeNull();
  });

  it("accepts the development project", () => {
    expect(
      e2eConfig({ ...keys, NEXT_PUBLIC_SUPABASE_URL: "https://tjapltuyhlyxwfqhcimf.supabase.co" }),
    ).not.toBeNull();
  });

  it("refuses the production project, whatever the case or path", () => {
    for (const url of [
      "https://hoqbflkszzoojdswbrgy.supabase.co",
      "https://HOQBFLKSZZOOJDSWBRGY.supabase.co/",
      "https://hoqbflkszzoojdswbrgy.supabase.co.",
      "https://db.askedfor.app",
    ])
      expect(() => e2eConfig({ ...keys, NEXT_PUBLIC_SUPABASE_URL: url })).toThrow(
        /production|development/,
      );
  });
});
