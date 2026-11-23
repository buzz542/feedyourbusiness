import { describe, expect, it } from "vitest";
import { PASSWORD_SET_KEY, canSignInAgain } from "./credentials";

/** Whether an account can come back without an email link (the set-password step). */

describe("canSignInAgain", () => {
  it("is true once the password step has been done", () => {
    expect(canSignInAgain({ user_metadata: { [PASSWORD_SET_KEY]: true } })).toBe(true);
  });

  it("is false for an email-link account that has not set a password", () => {
    expect(canSignInAgain({})).toBe(false);
    expect(canSignInAgain({ user_metadata: {} })).toBe(false);
  });

  it("needs the flag to be exactly true, not a truthy string", () => {
    for (const value of ["true", 1, "yes", null])
      expect(canSignInAgain({ user_metadata: { [PASSWORD_SET_KEY]: value } })).toBe(false);
  });
});
