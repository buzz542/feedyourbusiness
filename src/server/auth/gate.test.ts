import { describe, expect, it } from "vitest";
import { parseAllowlist } from "./allowlist";
import { gateUser, loginPathFor } from "./gate";

const allowed = parseAllowlist("founder@example.test");
const user = (email: string | null) => ({ id: "u1", email, createdAt: new Date(0) });

describe("gateUser: who may see an app page", () => {
  it("sends an anonymous visitor to sign in", () => {
    expect(gateUser(null, allowed)).toEqual({ kind: "anonymous" });
  });

  it("refuses a signed-in account off the allowlist, however it was created", () => {
    expect(gateUser(user("stranger@example.test"), allowed)).toEqual({ kind: "refused" });
    expect(gateUser(user(null), allowed)).toEqual({ kind: "refused" });
  });

  it("lets an allowed account in", () => {
    expect(gateUser(user("Founder@Example.test"), allowed)).toEqual({
      kind: "ok",
      user: user("Founder@Example.test"),
    });
  });
});

describe("loginPathFor", () => {
  it("returns to the page after sign-in", () => {
    expect(loginPathFor("/app/rivals?x=1")).toBe("/login?next=%2Fapp%2Frivals%3Fx%3D1");
  });

  it("drops a destination that is not a safe app path", () => {
    expect(loginPathFor("//evil.example")).toBe("/login");
    expect(loginPathFor("/app")).toBe("/login");
  });
});
