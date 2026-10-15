import { getRedirectUrl, getRewrittenUrl, isRewrite } from "next/experimental/testing/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";
import {
  createProxy,
  NOT_FOUND_PATH,
  type ProxyDeps,
  type ProxySession,
} from "@/server/auth/proxy-handler";

/** The proxy (docs/PLAN.md 12.1): matcher as Next evaluates it, and the handler with a fake session. */

describe("proxy matcher", () => {
  it.each([
    "/app",
    "/app/reply",
    "/admin",
    "/admin/removals",
    "/login",
    "/",
    "/api/billing/checkout",
    "/api/cronjob",
    "/api/healthz",
    "/api/billing/webhook-status",
    "/admin/removals/1.txt",
    "/app/x.png",
    "/app",
    "/app/reply/feed.webmanifest",
  ])("runs on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each([
    "/api/billing/webhook",
    "/api/cron/trial-reminders",
    "/api/cron/daily",
    "/api/health",
    "/_next/static/chunks/main.js",
    "/_next/image?url=x",
    "/favicon.ico",
    "/robots.txt",
    "/icon.png",
    "/fonts/geist.woff2",
  ])("never runs on %s, so the webhook, crons, health and static files pass untouched", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});

const ENV = { SIGNUP_ALLOWLIST: "founder@example.test,admin@example.test" };
const SESSION_COOKIE = { name: "sb-x-auth-token", value: "refreshed", options: { path: "/" } };
const NO_STORE = { "cache-control": "private, no-cache, no-store, must-revalidate, max-age=0" };

function deps(session: Partial<ProxySession> | null, over: Partial<ProxyDeps> = {}): ProxyDeps {
  return {
    env: ENV,
    loadSession: vi.fn(async (_request, onCookies) => {
      onCookies([SESSION_COOKIE], NO_STORE);
      return session
        ? {
            userId: "u1",
            email: "founder@example.test",
            isAdmin: vi.fn(async () => false),
            ...session,
          }
        : null;
    }),
    ...over,
  };
}

const req = (path: string) => new NextRequest(`https://askedfor.app${path}`);

describe("createProxy", () => {
  it("lets a signed-in user through and carries the refreshed cookie and no-store headers", async () => {
    const res = await createProxy(deps({}))(req("/app/reply"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.cookies.get("sb-x-auth-token")?.value).toBe("refreshed");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("redirects an anonymous visitor to sign in, keeping cookies and headers on the redirect", async () => {
    const res = await createProxy(deps(null))(req("/app/rivals?x=1"));
    const to = new URL(getRedirectUrl(res)!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe("/app/rivals?x=1");
    expect(res.cookies.get("sb-x-auth-token")?.value).toBe("refreshed");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("answers /admin with the ordinary not-found page for a non-admin, cookies kept", async () => {
    const d = deps({});
    const res = await createProxy(d)(req("/admin/costs"));
    expect(isRewrite(res)).toBe(true);
    expect(new URL(getRewrittenUrl(res)!).pathname).toBe(NOT_FOUND_PATH);
    expect(res.cookies.get("sb-x-auth-token")?.value).toBe("refreshed");
  });

  it("asks for the admin flag only on /admin, and lets an admin in", async () => {
    const isAdmin = vi.fn(async () => true);
    const d = deps({ email: "admin@example.test", isAdmin });
    await createProxy(d)(req("/app/reply"));
    expect(isAdmin).not.toHaveBeenCalled();
    const res = await createProxy(d)(req("/admin"));
    expect(isAdmin).toHaveBeenCalledTimes(1);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("checks the admin flag for an encoded /admin path too", async () => {
    const isAdmin = vi.fn(async () => false);
    const res = await createProxy(deps({ isAdmin }))(req("/%61dmin"));
    expect(isAdmin).toHaveBeenCalledTimes(1);
    expect(isRewrite(res)).toBe(true);
  });

  it("fails closed when the admin check throws", async () => {
    const isAdmin = vi.fn(async () => Promise.reject(new Error("db")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createProxy(deps({ email: "admin@example.test", isAdmin }))(req("/admin"));
    expect(isRewrite(res)).toBe(true);
  });

  it("fails closed when reading the session throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps(null, {
      loadSession: vi.fn(async () => Promise.reject(new Error("auth down"))),
    });
    const res = await createProxy(d)(req("/app/reply"));
    expect(new URL(getRedirectUrl(res)!).pathname).toBe("/login");
  });

  it("treats a session whose email is off the allowlist as signed out", async () => {
    const res = await createProxy(deps({ email: "stranger@example.test" }))(req("/app/reply"));
    expect(getRedirectUrl(res)).toBe("https://askedfor.app/login?beta=1");
  });

  it("never reads the session on skipped paths", async () => {
    const d = deps({});
    await createProxy(d)(req("/api/billing/webhook"));
    expect(d.loadSession).not.toHaveBeenCalled();
  });
});

describe("proxy without Supabase configuration", () => {
  it("fails closed on /app and /admin and passes public pages", async () => {
    const env = { ...process.env };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    try {
      const app = await proxy(req("/app/reply"));
      expect(new URL(getRedirectUrl(app)!).pathname).toBe("/login");
      expect(isRewrite(await proxy(req("/admin")))).toBe(true);
      expect((await proxy(req("/"))).headers.get("x-middleware-next")).toBe("1");
    } finally {
      process.env = env;
    }
  });
});
