import { describe, expect, it } from "vitest";
import { assertDevSupabase, assertLocalBaseUrl, e2eSkipReason, isLocalRequestUrl } from "./guard";

/** E2E runs against localhost only (CLAUDE.md, .claude/rules/testing.md) and never production data. */

describe("assertLocalBaseUrl", () => {
  it.each([
    "http://localhost:3000",
    "http://localhost:3000/",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "https://localhost:3443",
  ])("accepts %s", (url) => {
    expect(() => assertLocalBaseUrl(url)).not.toThrow();
  });

  it.each([
    "https://askedfor.app",
    "https://askedfor-git-main-buzz542s-projects.vercel.app",
    "http://localhost.evil.example:3000",
    "http://evil.example/localhost",
    "http://user@evil.example",
    "http://localhost@evil.example",
    "http://10.0.0.5:3000",
    "http://192.168.1.10:3000",
    "http://0.0.0.0:3000",
    "ftp://localhost",
    "file:///tmp/x",
    "not a url",
    "",
  ])("refuses %s", (url) => {
    expect(() => assertLocalBaseUrl(url)).toThrow(/localhost/);
  });
});

describe("assertDevSupabase", () => {
  it("refuses the production project", () => {
    expect(() => assertDevSupabase("https://hoqbflkszzoojdswbrgy.supabase.co")).toThrow(
      /production/,
    );
  });

  it("refuses it in any letter case", () => {
    expect(() => assertDevSupabase("https://HOQBFLKSZZOOJDSWBRGY.supabase.co")).toThrow(
      /production/,
    );
  });

  it("accepts another project", () => {
    expect(() => assertDevSupabase("https://abcdefghijklmnopqrst.supabase.co")).not.toThrow();
  });
});

describe("isLocalRequestUrl", () => {
  it.each([
    "http://localhost:3210/app",
    "http://127.0.0.1:3210/_next/x.js",
    "data:image/png;base64,AA",
  ])("lets %s through", (url) => expect(isLocalRequestUrl(url)).toBe(true));

  it.each([
    "https://www.reddit.com/",
    "https://fonts.googleapis.com/x",
    "https://localhost.evil.example/",
  ])("blocks %s", (url) => expect(isLocalRequestUrl(url)).toBe(false));
});

describe("e2eSkipReason", () => {
  const full = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    SUPABASE_SECRET_KEY: "sb_secret_x",
  };

  it("runs when the development project's keys are present", () => {
    expect(e2eSkipReason(full)).toBeNull();
  });

  it("explains a skip when the secret key is missing", () => {
    expect(e2eSkipReason({ ...full, SUPABASE_SECRET_KEY: undefined })).toMatch(
      /SUPABASE_SECRET_KEY.*F12/,
    );
  });

  it("explains a skip when the project URL or publishable key is missing", () => {
    expect(e2eSkipReason({ ...full, NEXT_PUBLIC_SUPABASE_URL: "" })).toMatch(/F12/);
    expect(e2eSkipReason({ ...full, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined })).toMatch(
      /F12/,
    );
  });

  it("explains a skip with the placeholder keys from .env.example", () => {
    expect(e2eSkipReason({ ...full, SUPABASE_SECRET_KEY: "sb_secret_replace_me" })).toMatch(/F12/);
  });
});
