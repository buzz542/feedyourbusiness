import { describe, expect, it } from "vitest";
import { decideRoute, needsSession } from "./route-decision";

const anon = null;
const user = { id: "u1", isAdmin: false };
const admin = { id: "u2", isAdmin: true };

describe("needsSession: which requests the proxy touches", () => {
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
  ])("skips %s", (path) => {
    expect(needsSession(path)).toBe(false);
  });

  it.each([
    "/",
    "/login",
    "/app",
    "/app/reply",
    "/admin",
    "/auth/callback",
    "/api/billing/checkout",
  ])("refreshes the session on %s", (path) => {
    expect(needsSession(path)).toBe(true);
  });
});

describe("decideRoute", () => {
  it("sends an anonymous visitor on /app/x to /login with next", () => {
    expect(decideRoute("/app/x", "", anon)).toEqual({
      kind: "redirect",
      location: "/login?next=%2Fapp%2Fx",
    });
  });

  it("keeps the query in next", () => {
    expect(decideRoute("/app/rivals", "?week=2026-10-12", anon)).toEqual({
      kind: "redirect",
      location: `/login?next=${encodeURIComponent("/app/rivals?week=2026-10-12")}`,
    });
  });

  it("sends an anonymous visitor on /app to /login", () => {
    expect(decideRoute("/app", "", anon)).toEqual({
      kind: "redirect",
      location: "/login?next=%2Fapp",
    });
  });

  it("lets a signed-in user into /app", () => {
    expect(decideRoute("/app/reply", "", user)).toEqual({ kind: "next" });
  });

  it("gives a non-admin, signed in or not, a 404 on /admin", () => {
    expect(decideRoute("/admin", "", user)).toEqual({ kind: "not_found" });
    expect(decideRoute("/admin/removals", "", user)).toEqual({ kind: "not_found" });
    expect(decideRoute("/admin", "", anon)).toEqual({ kind: "not_found" });
  });

  it("lets an admin into /admin", () => {
    expect(decideRoute("/admin/removals", "", admin)).toEqual({ kind: "next" });
  });

  it.each(["/", "/login", "/pricing", "/application", "/administrator", "/api/billing/webhook"])(
    "leaves public path %s alone",
    (path) => {
      expect(decideRoute(path, "", anon)).toEqual({ kind: "next" });
    },
  );

  it("sends a signed-in user on /login to /app", () => {
    expect(decideRoute("/login", "", user)).toEqual({ kind: "redirect", location: "/app" });
  });
});
