import { describe, expect, it, vi } from "vitest";
import { handleAuthCallback, requestMagicLink, type AuthCallbackDeps } from "./sign-in";

const SITE = "https://askedfor.app";
const ALLOW = { SIGNUP_ALLOWLIST: "founder@example.test" };

describe("requestMagicLink", () => {
  const port = () => ({
    ensureUser: vi.fn(async () => ({ ok: true as const })),
    sendMagicLink: vi.fn(async () => ({ ok: true as const })),
  });

  it("sends a link to an allowed email, returning to the callback with a safe next path", async () => {
    const auth = port();
    const result = await requestMagicLink(
      { auth, siteUrl: SITE, env: ALLOW },
      { email: " Founder@Example.test ", next: "/app/rivals?x=1" },
    );
    expect(result).toEqual({ status: "sent" });
    expect(auth.ensureUser).toHaveBeenCalledWith("founder@example.test");
    expect(auth.sendMagicLink).toHaveBeenCalledWith(
      "founder@example.test",
      "https://askedfor.app/auth/callback?next=%2Fapp%2Frivals%3Fx%3D1",
    );
  });

  it("never contacts the auth provider for an email off the allowlist, so no account is created", async () => {
    const auth = port();
    const result = await requestMagicLink(
      { auth, siteUrl: SITE, env: ALLOW },
      { email: "stranger@example.test", next: null },
    );
    expect(result).toEqual({ status: "private_beta" });
    expect(auth.ensureUser).not.toHaveBeenCalled();
    expect(auth.sendMagicLink).not.toHaveBeenCalled();
  });

  it("rejects an invalid email without contacting the provider", async () => {
    const auth = port();
    for (const email of ["", "not-an-email", "a@b", `${"x".repeat(320)}@example.test`]) {
      expect(
        await requestMagicLink({ auth, siteUrl: SITE, env: ALLOW }, { email, next: null }),
      ).toEqual({
        status: "invalid_email",
      });
    }
    expect(auth.sendMagicLink).not.toHaveBeenCalled();
  });

  it("drops an unsafe next path", async () => {
    const auth = port();
    await requestMagicLink(
      { auth, siteUrl: SITE, env: ALLOW },
      { email: "founder@example.test", next: "//evil.example" },
    );
    expect(auth.sendMagicLink).toHaveBeenCalledWith(
      "founder@example.test",
      "https://askedfor.app/auth/callback?next=%2Fapp",
    );
  });

  it("returns an error instead of throwing when account setup throws", async () => {
    const auth = {
      ensureUser: vi.fn(async () => Promise.reject(new Error("no secret key"))),
      sendMagicLink: vi.fn(async () => ({ ok: true as const })),
    };
    expect(
      await requestMagicLink(
        { auth, siteUrl: SITE, env: ALLOW },
        { email: "founder@example.test", next: null },
      ),
    ).toEqual({ status: "error" });
    expect(auth.sendMagicLink).not.toHaveBeenCalled();
  });

  it("does not send a link when the account cannot be prepared", async () => {
    const auth = {
      ensureUser: vi.fn(async () => ({ ok: false as const, errorClass: "AuthApiError" })),
      sendMagicLink: vi.fn(async () => ({ ok: true as const })),
    };
    const result = await requestMagicLink(
      { auth, siteUrl: SITE, env: ALLOW },
      { email: "founder@example.test", next: null },
    );
    expect(result).toEqual({ status: "error" });
    expect(auth.sendMagicLink).not.toHaveBeenCalled();
  });

  it("reports a provider failure without leaking its message", async () => {
    const auth = {
      ensureUser: vi.fn(async () => ({ ok: true as const })),
      sendMagicLink: vi.fn(async () => ({ ok: false as const, errorClass: "AuthApiError" })),
    };
    const result = await requestMagicLink(
      { auth, siteUrl: SITE, env: ALLOW },
      { email: "founder@example.test", next: null },
    );
    expect(result).toEqual({ status: "error" });
  });
});

describe("handleAuthCallback", () => {
  const NOW = new Date("2026-10-15T12:00:00Z");
  function deps(over: Partial<AuthCallbackDeps> = {}): AuthCallbackDeps {
    return {
      env: ALLOW,
      now: NOW,
      exchangeCode: vi.fn(async () => ({
        id: "u1",
        email: "founder@example.test",
        createdAt: new Date(NOW.getTime() - 5_000),
      })),
      signOut: vi.fn(async () => {}),
      deleteNewUser: vi.fn(async () => {}),
      ...over,
    };
  }

  it("exchanges the code and goes to the safe next path", async () => {
    const d = deps();
    const to = await handleAuthCallback(
      d,
      new URL(`${SITE}/auth/callback?code=abc&next=%2Fapp%2Fbuild`),
    );
    expect(d.exchangeCode).toHaveBeenCalledWith("abc");
    expect(to).toBe("/app/build");
  });

  it("ignores token-hash links: only the browser-bound PKCE code signs anyone in", async () => {
    const d = deps();
    expect(
      await handleAuthCallback(d, new URL(`${SITE}/auth/callback?token_hash=t1&type=magiclink`)),
    ).toBe("/login?error=link");
    expect(d.exchangeCode).not.toHaveBeenCalled();
  });

  it("tells a first-time Google user to start with an email link while sign-up is off", async () => {
    expect(
      await handleAuthCallback(
        deps(),
        new URL(`${SITE}/auth/callback?error=access_denied&error_code=signup_disabled`),
      ),
    ).toBe("/login?error=first_time");
  });

  it("shows the expired-link notice for an expired email link", async () => {
    expect(
      await handleAuthCallback(
        deps(),
        new URL(`${SITE}/auth/callback?error=access_denied&error_code=otp_expired`),
      ),
    ).toBe("/login?error=link");
  });

  it("sends a cancelled Google sign-in back with the Google notice", async () => {
    expect(
      await handleAuthCallback(deps(), new URL(`${SITE}/auth/callback?error=access_denied`)),
    ).toBe("/login?error=google");
  });

  it("treats a throwing exchange as a failed link", async () => {
    const d = deps({ exchangeCode: vi.fn(async () => Promise.reject(new Error("boom"))) });
    expect(await handleAuthCallback(d, new URL(`${SITE}/auth/callback?code=abc`))).toBe(
      "/login?error=link",
    );
  });

  it("still turns a stranger away when deleting the new account fails", async () => {
    const d = deps({
      exchangeCode: vi.fn(async () => ({
        id: "u2",
        email: "stranger@example.test",
        createdAt: NOW,
      })),
      deleteNewUser: vi.fn(async () => Promise.reject(new Error("down"))),
    });
    expect(await handleAuthCallback(d, new URL(`${SITE}/auth/callback?code=abc`))).toBe(
      "/login?beta=1",
    );
    expect(d.signOut).toHaveBeenCalled();
  });

  it.each(["/.//evil.example", "/..//evil.example", "/a/..//evil.example", "/%2e//evil.example"])(
    "never follows a dot-segment trick in next (%s)",
    async (next) => {
      const to = await handleAuthCallback(
        deps(),
        new URL(`${SITE}/auth/callback?code=abc&next=${encodeURIComponent(next)}`),
      );
      expect(to).toBe("/app");
    },
  );

  it("never follows an unsafe next path", async () => {
    const to = await handleAuthCallback(
      deps(),
      new URL(`${SITE}/auth/callback?code=abc&next=https://evil.example`),
    );
    expect(to).toBe("/app");
  });

  it("sends a failed or missing code back to the login page", async () => {
    expect(await handleAuthCallback(deps(), new URL(`${SITE}/auth/callback`))).toBe(
      "/login?error=link",
    );
    const d = deps({ exchangeCode: vi.fn(async () => null) });
    expect(await handleAuthCallback(d, new URL(`${SITE}/auth/callback?code=bad`))).toBe(
      "/login?error=link",
    );
  });

  it("removes a just-created account that is not on the allowlist (Google sign-in) and signs out", async () => {
    const d = deps({
      exchangeCode: vi.fn(async () => ({
        id: "u2",
        email: "stranger@example.test",
        createdAt: new Date(NOW.getTime() - 3_000),
      })),
    });
    const to = await handleAuthCallback(d, new URL(`${SITE}/auth/callback?code=abc`));
    expect(to).toBe("/login?beta=1");
    expect(d.signOut).toHaveBeenCalled();
    expect(d.deleteNewUser).toHaveBeenCalledWith("u2");
  });

  it("never deletes an older account that has fallen off the allowlist; it only signs it out", async () => {
    const d = deps({
      exchangeCode: vi.fn(async () => ({
        id: "u3",
        email: "former@example.test",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      })),
    });
    const to = await handleAuthCallback(d, new URL(`${SITE}/auth/callback?code=abc`));
    expect(to).toBe("/login?beta=1");
    expect(d.signOut).toHaveBeenCalled();
    expect(d.deleteNewUser).not.toHaveBeenCalled();
  });
});
