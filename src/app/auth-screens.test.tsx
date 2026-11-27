import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** The sign-in screen and the set-password step, rendered. */

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/auth/deps", () => ({ getSignInDeps: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ requireAppUser: vi.fn() }));
vi.mock("@/server/auth/supabase-auth", () => ({ createSupabaseAuthGateway: vi.fn() }));

const tags = (html: string, name: string) => html.match(new RegExp(`<${name}[^>]*>`, "g")) ?? [];

describe("the sign-in form", () => {
  const render = async (next: string | null = null) => {
    const { LoginForm } = await import("@/app/(marketing)/login/login-form");
    return renderToStaticMarkup(createElement(LoginForm, { next }));
  };

  it("has an email box and a password box, and password managers are told which is which", async () => {
    const html = await render();
    const [email, password] = tags(html, "input");
    expect(email).toContain('name="email"');
    expect(email).toContain('autoComplete="username"');
    expect(password).toContain('type="password"');
    expect(password).toContain('autoComplete="current-password"');
  });

  it("offers sign in and a reset, with sign in first so Enter uses the password", async () => {
    const html = await render();
    const buttons = tags(html, "button");
    const intents = buttons.map((b) => /value="(\w+)"/.exec(b)?.[1]);
    expect(intents).toEqual(["password", "reset"]);
    for (const text of ["Sign in", "Forgot your password?"]) expect(html).toContain(text);
    expect(html).not.toContain("Google");
    // The sign-in link is gone: new people create an account instead.
    expect(html).not.toContain("Email me a sign-in link");
  });

  it("offers Create an account as a link to the sign-up page, keeping the next path", async () => {
    expect(await render()).toMatch(/<a[^>]*href="\/signup"[^>]*>Create an account<\/a>/);
    expect(await render("/app/reply")).toMatch(
      /<a[^>]*href="\/signup\?next=%2Fapp%2Freply"[^>]*>Create an account<\/a>/,
    );
  });

  it("lets the reset button skip the browser checks, so an empty password does not block it", async () => {
    const buttons = tags(await render(), "button");
    const named = (intent: string) => buttons.find((b) => b.includes(`value="${intent}"`))!;
    expect(named("reset")).toContain("formNoValidate");
    expect(named("password")).not.toContain("formNoValidate");
  });

  it("carries the next path in a hidden field", async () => {
    const html = await render("/app/reply");
    expect(
      tags(html, "input").some((i) => i.includes('name="next"') && i.includes("/app/reply")),
    ).toBe(true);
  });
});

describe("the create-account form", () => {
  const render = async (next: string | null = null) => {
    const { SignupForm } = await import("@/app/(marketing)/signup/signup-form");
    return renderToStaticMarkup(createElement(SignupForm, { next }));
  };

  it("asks for an email, a password and the password again, and tells password managers they are new", async () => {
    const html = await render();
    const inputs = tags(html, "input");
    expect(inputs.map((i) => /name="(\w+)"/.exec(i)?.[1])).toEqual([
      "email",
      "password",
      "confirm",
    ]);
    expect(inputs[0]).toContain('type="email"');
    expect(inputs[0]).toContain('autoComplete="username"');
    for (const i of inputs.slice(1)) {
      expect(i).toContain('type="password"');
      expect(i).toContain('autoComplete="new-password"');
      expect(i).toContain("minLength");
    }
    for (const label of ["Email", "Password", "Confirm password"])
      expect(html).toMatch(new RegExp(`<label[^>]*>${label}</label>`));
  });

  it("has one Create account button, a way back to sign in, and says a verification email is sent", async () => {
    const html = await render("/app/reply");
    expect(tags(html, "button")).toHaveLength(1);
    expect(html).toContain("Create account");
    expect(html).toMatch(/<a[^>]*href="\/login\?next=%2Fapp%2Freply"[^>]*>Sign in<\/a>/);
    expect(html).toContain("We email you a link to verify your address");
    expect(
      tags(html, "input").some((i) => i.includes('name="next"') && i.includes("/app/reply")),
    ).toBe(true);
  });
});

describe("the set-password form", () => {
  it("asks twice, tells the browser they are new passwords, and sets the minimum", async () => {
    const { PasswordForm } = await import("@/app/(app)/app/(setup)/password/password-form");
    const html = renderToStaticMarkup(createElement(PasswordForm));
    const inputs = tags(html, "input");
    expect(inputs.map((i) => /name="(\w+)"/.exec(i)?.[1])).toEqual(["password", "confirm"]);
    for (const input of inputs) {
      expect(input).toContain('autoComplete="new-password"');
      expect(input).toContain('minLength="10"');
      expect(input).toContain("required");
    }
    expect(html).toContain("Save password");
  });
});
