import { describe, expect, it } from "vitest";
import { parseAllowlist } from "./allowlist";
import { createFakeAuth } from "./fakes";
import { acceptTerms, handleAuthCallback, requestMagicLink, startGoogleSignIn } from "./sign-in";

const SITE = "https://askedfor.example.test";
const NOW = new Date("2026-10-22T12:00:00Z");
const allowlist = parseAllowlist("founder@example.test");

describe("requestMagicLink", () => {
  it("sends a link to an allowlisted email, redirecting to the callback with a safe next", async () => {
    const auth = createFakeAuth();
    const result = await requestMagicLink(
      { auth, allowlist, siteUrl: SITE },
      { email: " Founder@Example.test ", next: "/app/rivals?x=1" },
    );
    expect(result).toEqual({ status: "sent" });
    expect(auth.magicLinks).toEqual([
      {
        email: "founder@example.test",
        redirectTo: `${SITE}/auth/callback?next=${encodeURIComponent("/app/rivals?x=1")}`,
      },
    ]);
  });

  it("an email not on the allowlist gets no account: the auth service is never called", async () => {
    const auth = createFakeAuth();
    const result = await requestMagicLink(
      { auth, allowlist, siteUrl: SITE },
      { email: "stranger@example.test", next: null },
    );
    expect(result).toEqual({ status: "private_beta" });
    expect(auth.magicLinks).toEqual([]);
    expect(auth.users.size).toBe(0);
  });

  it("refuses an invalid email without calling the auth service", async () => {
    const auth = createFakeAuth();
    for (const email of ["", "not-an-email", "a@b", "x".repeat(400) + "@example.test"]) {
      expect(
        await requestMagicLink({ auth, allowlist, siteUrl: SITE }, { email, next: null }),
      ).toEqual({
        status: "invalid_email",
      });
    }
    expect(auth.magicLinks).toEqual([]);
  });

  it("replaces an unsafe next with /app", async () => {
    const auth = createFakeAuth();
    await requestMagicLink(
      { auth, allowlist, siteUrl: SITE },
      { email: "founder@example.test", next: "//evil.example" },
    );
    expect(auth.magicLinks[0]?.redirectTo).toBe(`${SITE}/auth/callback?next=%2Fapp`);
  });

  it("reports a send failure without leaking it", async () => {
    const auth = createFakeAuth({ failSend: true });
    expect(
      await requestMagicLink(
        { auth, allowlist, siteUrl: SITE },
        { email: "founder@example.test", next: null },
      ),
    ).toEqual({ status: "error" });
  });
});

describe("startGoogleSignIn", () => {
  it("returns the provider URL with the callback redirect", async () => {
    const auth = createFakeAuth();
    const result = await startGoogleSignIn({ auth, siteUrl: SITE }, { next: "/app/build" });
    expect(result).toEqual({
      status: "redirect",
      url: expect.stringContaining("accounts.example.test"),
    });
    expect(auth.oauthRedirects).toEqual([`${SITE}/auth/callback?next=%2Fapp%2Fbuild`]);
  });
});

describe("handleAuthCallback", () => {
  const deps = (auth = createFakeAuth()) => ({ auth, allowlist, now: () => NOW });

  it("exchanges the code and goes to a safe next path", async () => {
    const auth = createFakeAuth();
    auth.pendingCodes.set("code-1", { email: "founder@example.test", createdAt: NOW });
    const result = await handleAuthCallback(deps(auth), {
      code: "code-1",
      next: "/app/rivals?x=1",
    });
    expect(result).toEqual({ location: "/app/rivals?x=1", newUserId: expect.any(String) });
    expect(auth.signedIn).toBe(true);
  });

  it("verifies a token hash link too", async () => {
    const auth = createFakeAuth();
    auth.pendingTokens.set("hash-1", { email: "founder@example.test", createdAt: NOW });
    const result = await handleAuthCallback(deps(auth), {
      tokenHash: "hash-1",
      type: "magiclink",
      next: "https://evil.example",
    });
    expect(result.location).toBe("/app");
    expect(auth.signedIn).toBe(true);
  });

  it("reports a returning user as not new", async () => {
    const auth = createFakeAuth();
    auth.pendingCodes.set("code-1", {
      email: "founder@example.test",
      createdAt: new Date(NOW.getTime() - 86_400_000),
    });
    const result = await handleAuthCallback(deps(auth), { code: "code-1", next: null });
    expect(result).toEqual({ location: "/app", newUserId: null });
  });

  it("deletes a just-created account that is not on the allowlist (Google sign-in) and signs out", async () => {
    const auth = createFakeAuth();
    auth.pendingCodes.set("code-2", { email: "stranger@example.test", createdAt: NOW });
    const result = await handleAuthCallback(deps(auth), { code: "code-2", next: "/app" });
    expect(result).toEqual({ location: "/login?error=private_beta", newUserId: null });
    expect(auth.users.size).toBe(0);
    expect(auth.signedIn).toBe(false);
  });

  it("signs out, but never deletes, an older account no longer on the allowlist", async () => {
    const auth = createFakeAuth();
    auth.pendingCodes.set("code-3", {
      email: "stranger@example.test",
      createdAt: new Date(NOW.getTime() - 86_400_000),
    });
    const result = await handleAuthCallback(deps(auth), { code: "code-3", next: "/app" });
    expect(result.location).toBe("/login?error=private_beta");
    expect(auth.users.size).toBe(1);
    expect(auth.signedIn).toBe(false);
  });

  it.each([
    [{ next: "/app" }],
    [{ code: "unknown", next: "/app" }],
    [{ tokenHash: "unknown", type: "magiclink", next: "/app" }],
    [{ tokenHash: "hash-1", type: "signup-but-wrong", next: "/app" }],
  ])("sends a missing or bad code back to login: %j", async (input) => {
    const auth = createFakeAuth();
    auth.pendingTokens.set("hash-1", { email: "founder@example.test", createdAt: NOW });
    const result = await handleAuthCallback(deps(auth), input);
    expect(result).toEqual({ location: "/login?error=link", newUserId: null });
    expect(auth.signedIn).toBe(false);
  });
});

describe("acceptTerms", () => {
  it("stores the acceptance time once and never moves it", async () => {
    const auth = createFakeAuth();
    const store = auth.profiles;
    store.set("u1", { termsAcceptedAt: null });
    expect(await acceptTerms(auth, "u1", NOW)).toBe(true);
    expect(store.get("u1")?.termsAcceptedAt).toEqual(NOW);
    expect(await acceptTerms(auth, "u1", new Date(NOW.getTime() + 1000))).toBe(false);
    expect(store.get("u1")?.termsAcceptedAt).toEqual(NOW);
  });
});
