import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAccountAdmin, FakeAuthGateway, FakeTermsStore } from "./fakes";
import type { SignInDeps } from "./sign-in";
import {
  acceptTerms,
  callbackUrl,
  completeSignIn,
  requestMagicLink,
  startGoogleSignIn,
} from "./sign-in";
import { parseAllowlist } from "./allowlist";

/** Sign-in (docs/PLAN.md 4.3, 12.1, 12.10), with fakes for Supabase Auth. */

const SITE = "https://askedfor.example.test";
const NOW = new Date("2026-10-24T09:00:00Z");

let auth: FakeAuthGateway;
let admin: FakeAccountAdmin;
let deps: SignInDeps;

beforeEach(() => {
  auth = new FakeAuthGateway();
  // Shares state with the gateway: a link to an email with no account fails, as in Supabase.
  admin = new FakeAccountAdmin(auth);
  deps = {
    auth,
    admin,
    isAllowed: parseAllowlist("founder@example.test"),
    siteUrl: SITE,
    now: () => NOW,
    // A local dev server, where the E2E helper signs in with a token hash.
    allowEmailTokenHash: true,
  };
});

afterEach(() => vi.restoreAllMocks());

describe("callbackUrl", () => {
  it("is the bare callback for the default destination", () => {
    expect(callbackUrl(SITE, null)).toBe(`${SITE}/auth/callback`);
    expect(callbackUrl(SITE, "/app")).toBe(`${SITE}/auth/callback`);
    expect(callbackUrl(SITE, "https://evil.example")).toBe(`${SITE}/auth/callback`);
  });

  it("carries a safe next path, encoded", () => {
    expect(callbackUrl(SITE, "/app/rivals?x=1")).toBe(
      `${SITE}/auth/callback?next=${encodeURIComponent("/app/rivals?x=1")}`,
    );
  });
});

describe("requestMagicLink", () => {
  it("creates the account for an allowed email, then sends a link back to the callback", async () => {
    const result = await requestMagicLink(deps, { email: " Founder@Example.test ", next: null });
    expect(result).toEqual({ kind: "sent" });
    // Supabase has sign-ups turned off until launch, so the server makes the account first.
    expect(admin.ensured).toEqual(["founder@example.test"]);
    expect(auth.magicLinks).toEqual([
      { email: "founder@example.test", redirectTo: `${SITE}/auth/callback` },
    ]);
  });

  it("sends no link when the account cannot be created", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    admin.failNextEnsure = true;
    expect(await requestMagicLink(deps, { email: "founder@example.test", next: null })).toEqual({
      kind: "error",
    });
    expect(auth.magicLinks).toEqual([]);
  });

  it("an email not on the allowlist gets no account: Supabase is never called", async () => {
    const result = await requestMagicLink(deps, { email: "stranger@example.test", next: null });
    expect(result).toEqual({ kind: "private_beta" });
    expect(auth.magicLinks).toEqual([]);
    expect(admin.ensured).toEqual([]);
    expect(auth.accounts.size).toBe(0);
  });

  it.each(["", "not-an-email", "a@b", `${"x".repeat(320)}@example.test`])(
    "refuses an invalid email %j without calling Supabase",
    async (email) => {
      expect(await requestMagicLink(deps, { email, next: null })).toEqual({ kind: "invalid" });
      expect(auth.magicLinks).toEqual([]);
    },
  );

  it("reports a send failure without leaking the error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    auth.failNextSend = true;
    expect(await requestMagicLink(deps, { email: "founder@example.test", next: null })).toEqual({
      kind: "error",
    });
    expect(spy.mock.calls.flat().join(" ")).not.toContain("founder@example.test");
    spy.mockRestore();
  });
});

describe("startGoogleSignIn", () => {
  it("returns the provider URL with the callback as the redirect", async () => {
    const result = await startGoogleSignIn(deps, { next: "/app/build" });
    expect(result).toEqual({
      kind: "redirect",
      url: `https://auth.example.test/google?redirect_to=${encodeURIComponent(
        `${SITE}/auth/callback?next=${encodeURIComponent("/app/build")}`,
      )}`,
    });
  });
});

describe("completeSignIn", () => {
  it("exchanges the code and goes to the safe next path", async () => {
    auth.pendingCodes.set("code-1", { email: "founder@example.test", createdAt: NOW });
    expect(await completeSignIn(deps, { code: "code-1", next: "/app/rivals?x=1" })).toBe(
      "/app/rivals?x=1",
    );
    expect(auth.signedIn?.email).toBe("founder@example.test");
  });

  it("never redirects off the site", async () => {
    auth.pendingCodes.set("code-1", { email: "founder@example.test", createdAt: NOW });
    expect(await completeSignIn(deps, { code: "code-1", next: "//evil.example" })).toBe("/app");
  });

  it.each([
    ["no code", null],
    ["an unknown or expired code", "nope"],
  ])("sends %s back to login with an error", async (_label, code) => {
    expect(await completeSignIn(deps, { code, next: null })).toBe("/login?error=link");
    expect(auth.signedIn).toBeNull();
  });

  it("verifies an email token hash (Supabase's email-link flow) and goes to the next path", async () => {
    auth.pendingTokenHashes.set("hash-1", { email: "founder@example.test", createdAt: NOW });
    expect(
      await completeSignIn(deps, {
        code: null,
        tokenHash: "hash-1",
        type: "magiclink",
        next: "/app/build",
      }),
    ).toBe("/app/build");
    expect(auth.signedIn?.email).toBe("founder@example.test");
  });

  it("refuses an email token hash outside a local dev server: it skips PKCE, so a link sent by someone else could sign you into their account", async () => {
    auth.pendingTokenHashes.set("hash-csrf", { email: "founder@example.test", createdAt: NOW });
    expect(
      await completeSignIn(
        { ...deps, allowEmailTokenHash: false },
        { code: null, tokenHash: "hash-csrf", type: "magiclink", next: null },
      ),
    ).toBe("/login?error=link");
    expect(auth.signedIn).toBeNull();
  });

  it("applies the allowlist to an email token hash too", async () => {
    auth.pendingTokenHashes.set("hash-2", { email: "stranger@example.test", createdAt: NOW });
    expect(
      await completeSignIn(deps, { code: null, tokenHash: "hash-2", type: "email", next: null }),
    ).toBe("/login?error=private_beta");
    expect(auth.signedIn).toBeNull();
  });

  it.each(["signup", "recovery", "invite", "email_change", "", "nonsense"])(
    "refuses a token hash of type %j",
    async (type) => {
      auth.pendingTokenHashes.set("hash-3", { email: "founder@example.test", createdAt: NOW });
      expect(
        await completeSignIn(deps, { code: null, tokenHash: "hash-3", type, next: null }),
      ).toBe("/login?error=link");
      expect(auth.signedIn).toBeNull();
    },
  );

  it("explains a refused first Google sign-in while Supabase sign-ups are off", async () => {
    expect(
      await completeSignIn(deps, { code: null, next: null, errorCode: "signup_disabled" }),
    ).toBe("/login?error=first_time");
  });

  it("an account Google just created for an email not on the allowlist is deleted at once", async () => {
    auth.pendingCodes.set("code-2", {
      email: "stranger@example.test",
      createdAt: new Date(NOW.getTime() - 30_000),
    });
    expect(await completeSignIn(deps, { code: "code-2", next: null })).toBe(
      "/login?error=private_beta",
    );
    expect(admin.deleted).toEqual([auth.lastExchangedId]);
    expect(auth.signedIn).toBeNull();
  });

  it.each([
    ["9 minutes", 9, true],
    ["11 minutes", 11, false],
    ["53 days", 53 * 24 * 60, false],
  ])(
    "an unused off-list account created %s ago is deleted only inside the 10 minute window",
    async (_label, minutes, deleted) => {
      auth.pendingCodes.set("code-3", {
        email: "former@example.test",
        createdAt: new Date(NOW.getTime() - minutes * 60_000),
      });
      expect(await completeSignIn(deps, { code: "code-3", next: null })).toBe(
        "/login?error=private_beta",
      );
      expect(admin.deleted).toEqual(deleted ? [auth.lastExchangedId] : []);
      expect(auth.signedIn).toBeNull();
    },
  );

  it("a fresh off-list account that was ever used is signed out, never deleted", async () => {
    // For example a tester dropped from SIGNUP_ALLOWLIST by mistake minutes after starting.
    admin.used.add("user-1");
    auth.pendingCodes.set("code-6", { email: "tester@example.test", createdAt: NOW });
    expect(await completeSignIn(deps, { code: "code-6", next: null })).toBe(
      "/login?error=private_beta",
    );
    expect(auth.lastExchangedId).toBe("user-1");
    expect(admin.deleted).toEqual([]);
    expect(auth.signedIn).toBeNull();
  });

  it("still signs the stranger out when the delete fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    admin.failNextDelete = true;
    auth.pendingCodes.set("code-4", { email: "stranger@example.test", createdAt: NOW });
    expect(await completeSignIn(deps, { code: "code-4", next: null })).toBe(
      "/login?error=private_beta",
    );
    expect(auth.signedIn).toBeNull();
    spy.mockRestore();
  });

  it("treats an account without an email as not allowed", async () => {
    auth.pendingCodes.set("code-5", { email: null, createdAt: NOW });
    expect(await completeSignIn(deps, { code: "code-5", next: null })).toBe(
      "/login?error=private_beta",
    );
  });
});

describe("acceptTerms", () => {
  let terms: FakeTermsStore;
  beforeEach(() => {
    terms = new FakeTermsStore();
  });

  it("needs both confirmations", async () => {
    for (const form of [
      { adult: true, terms: false },
      { adult: false, terms: true },
      { adult: false, terms: false },
    ]) {
      expect(await acceptTerms(terms, "user-1", form)).toEqual({ kind: "missing" });
    }
    expect(terms.writes).toBe(0);
  });

  it("is stored once: a second accept, as a double submit sends, changes nothing", async () => {
    expect(await acceptTerms(terms, "user-1", { adult: true, terms: true })).toEqual({
      kind: "accepted",
    });
    expect(await acceptTerms(terms, "user-1", { adult: true, terms: true })).toEqual({
      kind: "already",
    });
    expect(terms.acceptedAt.get("user-1")).toBeInstanceOf(Date);
    expect(terms.writes).toBe(1);
  });
});
