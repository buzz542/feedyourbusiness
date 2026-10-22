import { describe, expect, it } from "vitest";
import { assertSafeE2ETarget } from "./helpers/safety";

describe("E2E admin helpers: development project and test addresses only", () => {
  const dev = "https://abcdefghijklmnop.supabase.co";

  it("accepts a development project and a reserved address", () => {
    expect(() => assertSafeE2ETarget(dev, "e2e-user@example.com")).not.toThrow();
    expect(() => assertSafeE2ETarget(dev, "e2e@askedfor.test")).not.toThrow();
  });

  it.each([undefined, "", "https://hoqbflkszzoojdswbrgy.supabase.co"])(
    "refuses the production project or no URL: %j",
    (url) => {
      expect(() => assertSafeE2ETarget(url, "e2e-user@example.com")).toThrow(/production/);
    },
  );

  it.each(["founder@gmail.com", "someone@askedfor.app", "x@example.com.evil.io", "e2e@test"])(
    "refuses a real-looking address: %s",
    (email) => {
      expect(() => assertSafeE2ETarget(dev, email)).toThrow(/reserved/);
    },
  );
});
