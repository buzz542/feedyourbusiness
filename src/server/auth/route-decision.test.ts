import { describe, expect, it } from "vitest";
import { decideRoute, isSkippedPath } from "./route-decision";

const anon = { userId: null, allowed: false, isAdmin: false };
const user = { userId: "u1", allowed: true, isAdmin: false };
const admin = { userId: "u2", allowed: true, isAdmin: true };
const stranger = { userId: "u9", allowed: false, isAdmin: false };

const nextParam = (to: string) => new URL(to, "https://x.invalid").searchParams.get("next");

describe("decideRoute (docs/PLAN.md 12.1)", () => {
  it("sends an anonymous visitor on /app/x to sign in, coming back to /app/x", () => {
    const d = decideRoute({ pathname: "/app/x", search: "", ...anon });
    expect(d.kind).toBe("redirect");
    if (d.kind !== "redirect") return;
    expect(d.to.startsWith("/login?")).toBe(true);
    expect(nextParam(d.to)).toBe("/app/x");
  });

  it("keeps the query string in the return path", () => {
    const d = decideRoute({ pathname: "/app/reply", search: "?view=saved&source=reddit", ...anon });
    expect(d.kind === "redirect" && nextParam(d.to)).toBe("/app/reply?view=saved&source=reddit");
  });

  it("protects /app itself", () => {
    expect(decideRoute({ pathname: "/app", search: "", ...anon }).kind).toBe("redirect");
  });

  it("lets a signed-in user through to /app", () => {
    expect(decideRoute({ pathname: "/app/reply", search: "", ...user })).toEqual({ kind: "next" });
  });

  it("does not treat lookalike paths as protected", () => {
    expect(decideRoute({ pathname: "/apply", search: "", ...anon })).toEqual({ kind: "next" });
    expect(decideRoute({ pathname: "/administer", search: "", ...anon })).toEqual({ kind: "next" });
  });

  it("answers 404 on /admin for a signed-in non-admin", () => {
    expect(decideRoute({ pathname: "/admin", search: "", ...user })).toEqual({ kind: "not_found" });
    expect(decideRoute({ pathname: "/admin/removals", search: "", ...user })).toEqual({
      kind: "not_found",
    });
  });

  it("answers 404 on /admin for an anonymous visitor too, so it does not reveal itself", () => {
    expect(decideRoute({ pathname: "/admin", search: "", ...anon })).toEqual({ kind: "not_found" });
  });

  it("lets an admin into /admin", () => {
    expect(decideRoute({ pathname: "/admin/costs", search: "", ...admin })).toEqual({
      kind: "next",
    });
  });

  it("treats a session off the pre-launch allowlist as signed out (12.10)", () => {
    expect(decideRoute({ pathname: "/app/reply", search: "", ...stranger })).toEqual({
      kind: "redirect",
      to: "/login?beta=1",
    });
    expect(decideRoute({ pathname: "/login", search: "", ...stranger })).toEqual({ kind: "next" });
    expect(decideRoute({ pathname: "/admin", search: "", ...stranger, isAdmin: true })).toEqual({
      kind: "not_found",
    });
  });

  it("decides on the decoded path, as Next routes it", () => {
    expect(decideRoute({ pathname: "/%61dmin/costs", search: "", ...anon })).toEqual({
      kind: "not_found",
    });
    expect(decideRoute({ pathname: "/%61dmin", search: "", ...user })).toEqual({
      kind: "not_found",
    });
    const app = decideRoute({ pathname: "/%61pp/x", search: "", ...anon });
    expect(app.kind === "redirect" && nextParam(app.to)).toBe("/app/x");
    expect(decideRoute({ pathname: "/app%2Fwelcome", search: "", ...anon }).kind).toBe("redirect");
  });

  it("refuses a path it cannot decode", () => {
    expect(decideRoute({ pathname: "/%E0%A4%A", search: "", ...admin })).toEqual({
      kind: "not_found",
    });
  });

  it("sends a signed-in user away from /login to the app, keeping a safe next", () => {
    expect(decideRoute({ pathname: "/login", search: "", ...user })).toEqual({
      kind: "redirect",
      to: "/app",
    });
    expect(decideRoute({ pathname: "/login", search: "?next=%2Fapp%2Frivals", ...user })).toEqual({
      kind: "redirect",
      to: "/app/rivals",
    });
    expect(
      decideRoute({ pathname: "/login", search: "?next=%2F%2Fevil.example", ...user }),
    ).toEqual({ kind: "redirect", to: "/app" });
    expect(decideRoute({ pathname: "/login", search: "", ...anon })).toEqual({ kind: "next" });
  });

  it("leaves public pages alone", () => {
    for (const pathname of ["/", "/pricing", "/privacy", "/remove-my-post"]) {
      expect(decideRoute({ pathname, search: "", ...anon })).toEqual({ kind: "next" });
    }
  });
});

describe("isSkippedPath", () => {
  it.each([
    "/api/billing/webhook",
    "/api/cron/trial-reminders",
    "/api/cron/daily",
    "/api/health",
    "/_next/static/chunks/app.js",
    "/_next/image",
    "/favicon.ico",
    "/robots.txt",
  ])("skips %s", (p) => {
    expect(isSkippedPath(p)).toBe(true);
  });

  it.each(["/app", "/admin", "/login", "/api/billing/checkout", "/api/healthz", "/api/cronjob"])(
    "does not skip %s",
    (p) => {
      expect(isSkippedPath(p)).toBe(false);
    },
  );
});
