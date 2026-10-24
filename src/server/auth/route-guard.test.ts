import { describe, expect, it } from "vitest";
import { classifyPath, decideRoute } from "./route-guard";

/** The proxy's routing decision (docs/PLAN.md 12.1): what src/proxy.ts does for each request. */

describe("classifyPath", () => {
  it.each([
    "/api/billing/webhook",
    "/api/cron/trial-reminders",
    "/api/cron/daily",
    "/api/health",
    "/_next/static/chunks/main.js",
    "/_next/image",
    "/favicon.ico",
    "/robots.txt",
    "/fonts/x.woff2",
    "/auth/callback",
  ])("skips %s: no session work, passed through untouched", (path) => {
    expect(classifyPath(path)).toBe("skip");
  });

  it.each(["/app", "/app/", "/app/x", "/app/reply/saved", "/app/terms"])(
    "protects %s as the app",
    (path) => {
      expect(classifyPath(path)).toBe("app");
    },
  );

  it.each(["/admin", "/admin/removals"])("protects %s as admin", (path) => {
    expect(classifyPath(path)).toBe("admin");
  });

  it.each([
    "/",
    "/login",
    "/pricing",
    "/auth/callbackx",
    "/api/billing/checkout",
    "/application",
    "/appx",
    "/administrator",
    "/api/healthz",
    "/api/cronjob",
  ])("treats %s as public (session refreshed, nothing blocked)", (path) => {
    expect(classifyPath(path)).toBe("public");
  });
});

describe("decideRoute", () => {
  const anon = { signedIn: false, isAdmin: false };
  const member = { signedIn: true, isAdmin: false };
  const admin = { signedIn: true, isAdmin: true };

  it("sends an anonymous visitor on /app/x to sign in, returning there after", () => {
    expect(decideRoute("app", anon, "/app/x")).toEqual({
      kind: "redirect",
      to: "/login?next=%2Fapp%2Fx",
    });
  });

  it("keeps the query string in next", () => {
    expect(decideRoute("app", anon, "/app/rivals?x=1")).toEqual({
      kind: "redirect",
      to: "/login?next=%2Fapp%2Frivals%3Fx%3D1",
    });
  });

  it("sends an anonymous visitor on /app to plain /login", () => {
    expect(decideRoute("app", anon, "/app")).toEqual({ kind: "redirect", to: "/login" });
  });

  it("lets a server action POST through to the page, whose own check redirects it properly", () => {
    // A 307 would replay the POST against /login, which has no such action.
    expect(decideRoute("app", anon, "/app/terms", "POST")).toEqual({ kind: "pass" });
    expect(decideRoute("app", anon, "/app/x", "HEAD")).toEqual({
      kind: "redirect",
      to: "/login?next=%2Fapp%2Fx",
    });
  });

  it("still answers 404 to a non-admin POST on /admin", () => {
    expect(decideRoute("admin", member, "/admin", "POST")).toEqual({ kind: "not_found" });
  });

  it("lets a signed-in user into the app", () => {
    expect(decideRoute("app", member, "/app/x")).toEqual({ kind: "pass" });
  });

  it("answers 404 to a non-admin on /admin, and to an anonymous visitor, so admin is not revealed", () => {
    expect(decideRoute("admin", member, "/admin")).toEqual({ kind: "not_found" });
    expect(decideRoute("admin", anon, "/admin/removals")).toEqual({ kind: "not_found" });
  });

  it("lets an admin into /admin", () => {
    expect(decideRoute("admin", admin, "/admin")).toEqual({ kind: "pass" });
  });

  it("passes skipped and public paths whoever asks", () => {
    for (const who of [anon, member, admin]) {
      expect(decideRoute("skip", who, "/api/billing/webhook")).toEqual({ kind: "pass" });
      expect(decideRoute("public", who, "/pricing")).toEqual({ kind: "pass" });
    }
  });
});
