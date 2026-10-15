import { describe, expect, it } from "vitest";
import { allowedSessionUser } from "./session-user";

const env = { SIGNUP_ALLOWLIST: "founder@example.test" };

describe("allowedSessionUser (docs/PLAN.md 12.10)", () => {
  it("keeps a session for an email on the allowlist", () => {
    expect(allowedSessionUser({ id: "u1", email: "Founder@example.test" }, env)).toEqual({
      id: "u1",
      email: "Founder@example.test",
    });
  });

  it("treats a session for an email off the allowlist as signed out", () => {
    expect(allowedSessionUser({ id: "u2", email: "stranger@example.test" }, env)).toBeNull();
  });

  it("treats a session without an email as signed out", () => {
    expect(allowedSessionUser({ id: "u3", email: null }, env)).toBeNull();
    expect(allowedSessionUser({ id: "u3" }, env)).toBeNull();
  });

  it("returns null without a session", () => {
    expect(allowedSessionUser(null, env)).toBeNull();
  });
});
