import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAccountAdmin, FakeAuthGateway, FakeTermsStore } from "./fakes";
import type { SignInDeps } from "./sign-in";
import {
  acceptTerms,
  callbackUrl,
  createAccount,
  completeSignIn,
  MIN_PASSWORD_LENGTH,
  requestMagicLink,
  requestPasswordReset,
  setNewPassword,
  resendSignupCode,
  signInWithPassword,
  verifySignupCode,
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

  it("an account a refused sign-in just created for an email not on the allowlist is deleted at once", async () => {
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

describe("setNewPassword", () => {
  const GOOD = "correct horse battery";
  const signedIn = async (email = "founder@example.test") => {
    auth.signedIn = { id: "user-1", email, createdAt: NOW };
    return { email };
  };

  it("sets the password for the signed-in user, and marks the account as able to sign in again", async () => {
    const user = await signedIn();
    expect(await setNewPassword(auth, user, { password: GOOD, confirm: GOOD })).toEqual({
      kind: "set",
    });
    expect(auth.passwords.get("founder@example.test")).toBe(GOOD);
    expect((await auth.currentUser())?.canSignInAgain).toBe(true);
  });

  it(`refuses fewer than ${MIN_PASSWORD_LENGTH} characters`, async () => {
    const user = await signedIn();
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(await setNewPassword(auth, user, { password: short, confirm: short })).toEqual({
      kind: "too_short",
    });
    expect(auth.passwords.size).toBe(0);
  });

  it("refuses more than 72 bytes, where bcrypt would silently cut it off", async () => {
    const user = await signedIn();
    const long = "é".repeat(37);
    expect(await setNewPassword(auth, user, { password: long, confirm: long })).toEqual({
      kind: "too_long",
    });
    const edge = "a".repeat(72);
    expect(await setNewPassword(auth, user, { password: edge, confirm: edge })).toEqual({
      kind: "set",
    });
  });

  it("refuses two different entries", async () => {
    const user = await signedIn();
    expect(await setNewPassword(auth, user, { password: GOOD, confirm: GOOD + "!" })).toEqual({
      kind: "mismatch",
    });
    expect(auth.passwords.size).toBe(0);
  });

  it("refuses the email address as the password, in any case", async () => {
    const user = await signedIn();
    for (const password of ["founder@example.test", "Founder@Example.test"])
      expect(await setNewPassword(auth, user, { password, confirm: password })).toEqual({
        kind: "same_as_email",
      });
  });

  it("refuses anything that is not text", async () => {
    const user = await signedIn();
    for (const password of [undefined, null, 12345678901, ["a"]])
      expect(
        await setNewPassword(auth, user, {
          password: password as never,
          confirm: password as never,
        }),
      ).toEqual({ kind: "too_short" });
  });

  it("reports a failure to save without echoing the password", async () => {
    const user = await signedIn();
    auth.signedIn = null;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setNewPassword(auth, user, { password: GOOD, confirm: GOOD })).toEqual({
      kind: "error",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(GOOD);
  });
});

describe("signInWithPassword", () => {
  const PASSWORD = "correct horse battery";
  beforeEach(() => {
    auth.existingEmails.add("founder@example.test");
    auth.passwords.set("founder@example.test", PASSWORD);
  });

  it("signs in a right email and password, and goes to the safe next path", async () => {
    expect(
      await signInWithPassword(deps, {
        email: " Founder@Example.test ",
        password: PASSWORD,
        next: "/app/reply",
      }),
    ).toEqual({ kind: "ok", path: "/app/reply" });
    expect((await auth.currentUser())?.email).toBe("founder@example.test");
  });

  it("sends an unsafe next path to the default one", async () => {
    expect(
      await signInWithPassword(deps, {
        email: "founder@example.test",
        password: PASSWORD,
        next: "https://evil.example",
      }),
    ).toEqual({ kind: "ok", path: "/app" });
  });

  it("answers the same for a wrong password and for an email with no account, once the site is open", async () => {
    deps.isAllowed = () => true;
    const wrong = await signInWithPassword(deps, {
      email: "founder@example.test",
      password: "not the password",
      next: null,
    });
    const none = await signInWithPassword(deps, {
      email: "nobody@example.test",
      password: PASSWORD,
      next: null,
    });
    expect(wrong).toEqual({ kind: "wrong" });
    expect(none).toEqual(wrong);
    expect(await auth.currentUser()).toBeNull();
  });

  it("refuses an email that is not allowed yet, before it tries the password", async () => {
    auth.passwords.set("stranger@example.test", PASSWORD);
    expect(
      await signInWithPassword(deps, {
        email: "stranger@example.test",
        password: PASSWORD,
        next: null,
      }),
    ).toEqual({ kind: "private_beta" });
    expect(await auth.currentUser()).toBeNull();
  });

  it("lets any email try once the site is open", async () => {
    deps.isAllowed = () => true;
    auth.passwords.set("stranger@example.test", PASSWORD);
    expect(
      await signInWithPassword(deps, {
        email: "stranger@example.test",
        password: PASSWORD,
        next: null,
      }),
    ).toEqual({ kind: "ok", path: "/app" });
  });

  it("refuses a bad email and a missing or non-text password", async () => {
    expect(
      await signInWithPassword(deps, { email: "nope", password: PASSWORD, next: null }),
    ).toEqual({
      kind: "invalid",
    });
    for (const password of [undefined, "", 123, null])
      expect(
        await signInWithPassword(deps, {
          email: "founder@example.test",
          password: password as never,
          next: null,
        }),
      ).toEqual({ kind: "wrong" });
  });

  it("reports an outage as an error, and logs the class only", async () => {
    auth.failNextSignIn = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await signInWithPassword(deps, {
        email: "founder@example.test",
        password: PASSWORD,
        next: null,
      }),
    ).toEqual({ kind: "error" });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("founder@example.test");
    expect(logged).not.toContain(PASSWORD);
  });
});

describe("requestPasswordReset", () => {
  it("sends a reset link that lands on the set-password page, for an allowed email", async () => {
    auth.existingEmails.add("founder@example.test");
    expect(await requestPasswordReset(deps, { email: " Founder@Example.test " })).toEqual({
      kind: "sent",
    });
    expect(auth.resets).toEqual([
      {
        email: "founder@example.test",
        redirectTo: `${SITE}/auth/callback?next=${encodeURIComponent("/app/password")}`,
      },
    ]);
  });

  it("says sent for an email with no account too, and never creates one", async () => {
    expect(await requestPasswordReset(deps, { email: "founder@example.test" })).toEqual({
      kind: "sent",
    });
    expect(admin.ensured).toEqual([]);
  });

  it("refuses a bad email, and an email that is not allowed yet", async () => {
    expect(await requestPasswordReset(deps, { email: "nope" })).toEqual({ kind: "invalid" });
    expect(await requestPasswordReset(deps, { email: "stranger@example.test" })).toEqual({
      kind: "private_beta",
    });
    expect(auth.resets).toEqual([]);
  });

  it("reports a send failure as an error", async () => {
    auth.failNextSend = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await requestPasswordReset(deps, { email: "founder@example.test" })).toEqual({
      kind: "error",
    });
  });
});

describe("createAccount", () => {
  const GOOD = "correct horse battery";
  const input = (over: Record<string, unknown> = {}) => ({
    email: "founder@example.test",
    password: GOOD,
    confirm: GOOD,
    next: null,
    ...over,
  });

  it("signs the person up and has Supabase email a verification link that returns to the callback", async () => {
    expect(await createAccount(deps, input())).toEqual({ kind: "sent" });
    expect(auth.signUps).toEqual([
      { email: "founder@example.test", password: GOOD, redirectTo: `${SITE}/auth/callback` },
    ]);
  });

  it("keeps a safe next path through the verification link, and drops an unsafe one", async () => {
    await createAccount(deps, input({ next: "/app/reply" }));
    await createAccount(deps, input({ next: "https://evil.example" }));
    expect(auth.signUps.map((s) => s.redirectTo)).toEqual([
      `${SITE}/auth/callback?next=%2Fapp%2Freply`,
      `${SITE}/auth/callback`,
    ]);
  });

  it("normalizes the email", async () => {
    await createAccount(deps, input({ email: "  Founder@Example.TEST " }));
    expect(auth.signUps[0]!.email).toBe("founder@example.test");
  });

  it.each([
    ["an invalid email", { email: "not an email" }, "invalid"],
    ["no email", { email: undefined }, "invalid"],
    ["a password under the minimum", { password: "short", confirm: "short" }, "too_short"],
    ["no password", { password: undefined, confirm: undefined }, "too_short"],
    ["a password over 72 bytes", { password: "é".repeat(37), confirm: "é".repeat(37) }, "too_long"],
    ["passwords that differ", { confirm: `${GOOD}!` }, "mismatch"],
    [
      "the email as the password",
      {
        email: "founder@example.test",
        password: "founder@example.test",
        confirm: "founder@example.test",
      },
      "same_as_email",
    ],
  ])("refuses %s, and sends nothing", async (_name, over, kind) => {
    expect(await createAccount(deps, input(over))).toEqual({ kind });
    expect(auth.signUps).toEqual([]);
  });

  it("is private beta for an email off the allowlist, before any password is looked at", async () => {
    expect(
      await createAccount(deps, input({ email: "stranger@example.test", password: "x" })),
    ).toEqual({
      kind: "private_beta",
    });
    expect(auth.signUps).toEqual([]);
  });

  it("answers the same whether or not the email already has an account", async () => {
    auth.existingEmails.add("founder@example.test");
    expect(await createAccount(deps, input())).toEqual({ kind: "sent" });
  });

  it("says private beta, not an error, while Supabase has new sign-ups switched off", async () => {
    auth.signUpsDisabled = true;
    expect(await createAccount(deps, input())).toEqual({ kind: "private_beta" });
    expect(auth.signUps).toEqual([]);
  });

  it("logs the error class only when Supabase fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    auth.failNextSend = true;
    expect(await createAccount(deps, input())).toEqual({ kind: "error" });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("founder@example.test");
    expect(JSON.stringify(errors.mock.calls)).not.toContain(GOOD);
  });
});

describe("verifySignupCode", () => {
  const GOOD = "correct horse battery";
  const signUp = async () => {
    await createAccount(deps, {
      email: "founder@example.test",
      password: GOOD,
      confirm: GOOD,
      next: null,
    });
  };
  const verify = (over: Record<string, unknown> = {}) =>
    verifySignupCode(deps, {
      email: "founder@example.test",
      code: auth.lastCode,
      next: null,
      ...over,
    });

  it("signs the person in with the emailed code, from any device, and goes to the app", async () => {
    await signUp();
    expect(await verify()).toEqual({ kind: "ok", path: "/app" });
    expect(auth.signedIn?.email).toBe("founder@example.test");
  });

  it("goes on to a safe next path, never an unsafe one", async () => {
    await signUp();
    expect(await verify({ next: "/app/reply" })).toEqual({ kind: "ok", path: "/app/reply" });
    await signUp();
    expect(await verify({ next: "https://evil.example" })).toEqual({ kind: "ok", path: "/app" });
  });

  it("accepts the code as typed: spaces and a dash are ignored, and the email's case", async () => {
    await signUp();
    const spaced = `${auth.lastCode!.slice(0, 3)} ${auth.lastCode!.slice(3)}`;
    expect(await verify({ code: ` ${spaced} `, email: " Founder@Example.TEST " })).toEqual({
      kind: "ok",
      path: "/app",
    });
  });

  it.each([
    ["too short", "12345"],
    ["too long", "1234567"],
    ["letters", "abcdef"],
    ["empty", ""],
    ["not text", 123456],
    ["missing", undefined],
  ])("refuses a code that is %s before asking Supabase", async (_name, code) => {
    await signUp();
    expect(await verify({ code })).toEqual({ kind: "invalid" });
    expect(auth.signedIn).toBeNull();
  });

  it("says wrong for a code that does not match, and signs nobody in", async () => {
    await signUp();
    const other = auth.lastCode === "000000" ? "111111" : "000000";
    expect(await verify({ code: other })).toEqual({ kind: "wrong" });
    expect(auth.signedIn).toBeNull();
  });

  it("treats a code used once as wrong the second time", async () => {
    await signUp();
    const code = auth.lastCode;
    await verify();
    auth.signedIn = null;
    expect(await verify({ code })).toEqual({ kind: "wrong" });
  });

  it("is private beta for an email off the allowlist, and an invalid email is invalid", async () => {
    expect(
      await verifySignupCode(deps, { email: "stranger@example.test", code: "123456", next: null }),
    ).toEqual({
      kind: "private_beta",
    });
    expect(await verifySignupCode(deps, { email: "nope", code: "123456", next: null })).toEqual({
      kind: "invalid",
    });
  });

  it("logs the error class only when Supabase fails", async () => {
    await signUp();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    auth.failNextSignIn = true;
    expect(await verify()).toEqual({ kind: "error" });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("founder@example.test");
    expect(JSON.stringify(errors.mock.calls)).not.toContain(auth.lastCode!);
  });
});

describe("resendSignupCode", () => {
  it("sends a new code to an allowed email, and the old one stops working", async () => {
    await createAccount(deps, {
      email: "founder@example.test",
      password: "correct horse battery",
      confirm: "correct horse battery",
      next: null,
    });
    const first = auth.lastCode;
    expect(await resendSignupCode(deps, { email: "founder@example.test", next: null })).toEqual({
      kind: "sent",
    });
    expect(auth.resends).toEqual([
      { email: "founder@example.test", redirectTo: `${SITE}/auth/callback` },
    ]);
    expect(auth.lastCode).not.toBe(first);
    expect(
      await verifySignupCode(deps, { email: "founder@example.test", code: first, next: null }),
    ).toEqual({
      kind: "wrong",
    });
  });

  it("refuses an invalid email or one off the allowlist, and sends nothing", async () => {
    expect(await resendSignupCode(deps, { email: "nope", next: null })).toEqual({
      kind: "invalid",
    });
    expect(await resendSignupCode(deps, { email: "stranger@example.test", next: null })).toEqual({
      kind: "private_beta",
    });
    expect(auth.resends).toEqual([]);
  });

  it("logs the error class only when Supabase fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    auth.failNextSend = true;
    expect(await resendSignupCode(deps, { email: "founder@example.test", next: null })).toEqual({
      kind: "error",
    });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("founder@example.test");
  });
});
