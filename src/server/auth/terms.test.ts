import { describe, expect, it } from "vitest";
import { acceptTerms, termsInput } from "./terms";

describe("acceptTerms (docs/PLAN.md 4.3)", () => {
  function store() {
    const accepted = new Map<string, Date>();
    return {
      accepted,
      async acceptTermsOnce(userId: string, now: Date) {
        if (accepted.has(userId)) return false;
        accepted.set(userId, now);
        return true;
      },
    };
  }

  it("needs both confirmations", () => {
    expect(termsInput.safeParse({ adult: "on", terms: "on" }).success).toBe(true);
    expect(termsInput.safeParse({ adult: "on" }).success).toBe(false);
    expect(termsInput.safeParse({ terms: "on" }).success).toBe(false);
    expect(termsInput.safeParse({}).success).toBe(false);
  });

  it("stores the acceptance once", async () => {
    const s = store();
    const first = new Date("2026-10-15T10:00:00Z");
    expect(await acceptTerms(s, "u1", { adult: "on", terms: "on" }, first)).toEqual({
      ok: true,
      first: true,
    });
    expect(
      await acceptTerms(s, "u1", { adult: "on", terms: "on" }, new Date("2026-10-16T10:00:00Z")),
    ).toEqual({
      ok: true,
      first: false,
    });
    expect(s.accepted.get("u1")).toEqual(first);
  });

  it("runs the first-acceptance hook (signed_up) exactly once", async () => {
    const s = store();
    let calls = 0;
    const hook = async () => void calls++;
    const input = { adult: "on", terms: "on" };
    await acceptTerms(s, "u2", input, new Date(), hook);
    await acceptTerms(s, "u2", input, new Date(), hook);
    await acceptTerms(s, "u2", { adult: "on" }, new Date(), hook);
    expect(calls).toBe(1);
  });

  it("refuses without both boxes and stores nothing", async () => {
    const s = store();
    expect(await acceptTerms(s, "u1", { adult: "on" }, new Date())).toEqual({
      ok: false,
      error: "confirm_both",
    });
    expect(s.accepted.size).toBe(0);
  });
});
