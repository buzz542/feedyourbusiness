import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gateAppPage, type GateDeps } from "./app-gate";
import type { AccountState } from "./next-step";

/** Entitlement on every app data page (docs/PLAN.md 10.4) and the welcome step first (7.3). */

const USER = "00000000-0000-4000-8000-0000000000a1";
const confirmed = { status: "active" };

function deps(status: string | null, over: Partial<GateDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const account: AccountState = {
    termsAccepted: true,
    product: confirmed,
    subscriptionStatus: status,
  };
  const d: GateDeps = {
    async requireUser() {
      calls.push("user");
      return { id: USER };
    },
    async loadAccount() {
      calls.push("account");
      return { ...account };
    },
    async applyWelcome() {
      calls.push("welcome");
      return "applied";
    },
    async startFirstRun() {
      calls.push("first_run");
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, calls, logs, account };
}

describe("gateAppPage", () => {
  it.each([
    [null, "/app/billing"],
    ["canceled", "/app/billing"],
    ["incomplete", "/app/billing"],
    ["incomplete_expired", "/app/billing"],
    ["past_due", "/app/settings"],
    ["unpaid", "/app/settings"],
    ["paused", "/app/settings"],
  ])("a %s account is sent to %s and sees no data", async (status, to) => {
    expect(await gateAppPage(deps(status).d, { path: "/app/rivals" })).toEqual({
      kind: "redirect",
      to,
    });
  });

  it.each(["trialing", "active"])("a %s account sees the page", async (status) => {
    expect(await gateAppPage(deps(status).d, { path: "/app/build" })).toEqual({
      kind: "render",
      userId: USER,
    });
  });

  it("sends an account without terms or a confirmed product to its step first", async () => {
    const f = deps("trialing", {
      loadAccount: async () => ({
        termsAccepted: true,
        product: null,
        subscriptionStatus: "trialing",
      }),
    });
    expect(await gateAppPage(f.d, { path: "/app/reply" })).toEqual({
      kind: "redirect",
      to: "/app/onboarding",
    });
  });

  it("a just-paid user whose webhook has not arrived lands on Reply: the welcome step runs before the gate", async () => {
    let status: string | null = null;
    const order: string[] = [];
    const f = deps(null, {
      applyWelcome: async () => {
        order.push("welcome");
        status = "trialing";
        return "applied";
      },
      loadAccount: async () => {
        order.push("account");
        return { termsAccepted: true, product: confirmed, subscriptionStatus: status };
      },
      startFirstRun: async () => {
        order.push("first_run");
      },
    });
    const outcome = await gateAppPage(f.d, {
      path: "/app/reply",
      welcome: { sessionId: "cs_test_abc" },
    });
    // Back on /app/reply without session_id, with the first run started.
    expect(outcome).toEqual({ kind: "redirect", to: "/app/reply" });
    expect(order).toEqual(["welcome", "account", "first_run"]);
  });

  it("never offers billing when the welcome step fails: it waits for the webhook instead", async () => {
    const f = deps(null, {
      applyWelcome: async () => {
        throw new TypeError("connection reset for cus_secret");
      },
    });
    expect(
      await gateAppPage(f.d, { path: "/app/reply", welcome: { sessionId: "cs_test_abc" } }),
    ).toEqual({ kind: "confirming" });
    expect(f.logs).toEqual(["[billing] welcome failed: TypeError"]);
    expect(f.calls).not.toContain("first_run");
  });

  it.each(["stale", "pending"])(
    "shows the confirming state, never billing, when a real checkout is not settled yet (%s)",
    async (result) => {
      const f = deps(null, { applyWelcome: async () => result });
      expect(
        await gateAppPage(f.d, { path: "/app/reply", welcome: { sessionId: "cs_test_abc" } }),
      ).toEqual({ kind: "confirming" });
    },
  );

  it.each(["invalid", "mismatch"])(
    "sends a URL with no session of this user's (%s) to billing as usual",
    async (result) => {
      const f = deps(null, { applyWelcome: async () => result });
      expect(
        await gateAppPage(f.d, { path: "/app/reply", welcome: { sessionId: "cs_test_abc" } }),
      ).toEqual({ kind: "redirect", to: "/app/billing" });
    },
  );

  it("starts no first run for an account that is still not entitled after the welcome step", async () => {
    const f = deps("past_due");
    expect(
      await gateAppPage(f.d, { path: "/app/reply", welcome: { sessionId: "cs_test_abc" } }),
    ).toEqual({ kind: "redirect", to: "/app/settings" });
    expect(f.calls).not.toContain("first_run");
  });

  it("runs no welcome step without the Checkout return parameters", async () => {
    const f = deps("trialing");
    await gateAppPage(f.d, { path: "/app/reply" });
    expect(f.calls).toEqual(["user", "account"]);
  });
});

describe("every app data page goes through the gate", () => {
  const root = path.resolve(import.meta.dirname, "../../app/(app)/app/(tabs)");
  it.each(["reply", "rivals", "build"])("%s/page.tsx calls requireEntitledUser", (tab) => {
    const source = readFileSync(path.join(root, tab, "page.tsx"), "utf8");
    expect(source).toMatch(/await requireEntitledUser\(/);
    expect(source).not.toMatch(/requireAppUser\(/);
  });
});
