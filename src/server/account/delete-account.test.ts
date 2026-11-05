import { describe, expect, it } from "vitest";
import { deleteAccount, type AccountDeletionDeps } from "./delete-account";

/** Account deletion (docs/PLAN.md 4.7, 10.6) with fakes; the cascade itself is tests/db/account.test.ts. */

const USER = "00000000-0000-4000-8000-0000000000a1";

function fakes(over: Partial<{ status: string | null; sub: string | null }> = {}) {
  const calls: string[] = [];
  const audit: Array<{ actor: string; action: string; target: string | null }> = [];
  const events: Array<{ name: string; userId: string | null }> = [];
  let failCancel = false;
  let failAudit = false;
  let failDelete = false;
  const deps: AccountDeletionDeps = {
    async getBillingProfile(id) {
      calls.push(`profile:${id}`);
      return {
        id,
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: over.sub === undefined ? "sub_1" : over.sub,
        subscriptionStatus: (over.status === undefined ? "trialing" : over.status) as never,
      };
    },
    async cancelSubscriptionNow(id) {
      calls.push(`cancel:${id}`);
      if (failCancel) throw new Error("stripe down");
    },
    async writeAudit(entry) {
      calls.push("audit");
      if (failAudit) throw new Error("db down");
      audit.push(entry);
    },
    async deleteAuthUser(id) {
      calls.push(`delete:${id}`);
      if (failDelete) throw new Error("auth down");
    },
    async track(name, userId) {
      calls.push(`track:${name}`);
      events.push({ name, userId });
    },
  };
  return {
    deps,
    calls,
    audit,
    events,
    failCancel: () => (failCancel = true),
    failAudit: () => (failAudit = true),
    failDelete: () => (failDelete = true),
  };
}

describe("deleteAccount", () => {
  it("does nothing unless the user typed DELETE exactly", async () => {
    for (const typed of ["", "delete", "DELETE ", " DELETE", "DELET", "yes"]) {
      const f = fakes();
      expect(await deleteAccount(f.deps, USER, typed)).toBe("confirmation_mismatch");
      expect(f.calls).toEqual([]);
    }
  });

  it("cancels the subscription at once, writes the audit log, deletes the user, then records the event with no user id", async () => {
    const f = fakes();
    expect(await deleteAccount(f.deps, USER, "DELETE")).toBe("deleted");
    expect(f.calls).toEqual([
      `profile:${USER}`,
      "cancel:sub_1",
      "audit",
      `delete:${USER}`,
      "track:account_deleted",
    ]);
    expect(f.audit).toEqual([{ actor: "self", action: "account_deleted", target: USER }]);
    expect(f.events).toEqual([{ name: "account_deleted", userId: null }]);
  });

  it("cancels every subscription that could still bill, past_due and unpaid included", async () => {
    for (const status of ["trialing", "active", "past_due", "unpaid", "paused", "incomplete"]) {
      const f = fakes({ status });
      await deleteAccount(f.deps, USER, "DELETE");
      expect(f.calls).toContain("cancel:sub_1");
    }
  });

  it("skips Stripe when there is no subscription, or it has already ended", async () => {
    for (const over of [{ sub: null }, { status: "canceled" }, { status: "incomplete_expired" }]) {
      const f = fakes(over);
      expect(await deleteAccount(f.deps, USER, "DELETE")).toBe("deleted");
      expect(f.calls.some((c) => c.startsWith("cancel:"))).toBe(false);
      expect(f.calls).toContain(`delete:${USER}`);
    }
  });

  it("keeps the account when Stripe cannot cancel, so nobody is billed for a deleted account", async () => {
    const f = fakes();
    f.failCancel();
    await expect(deleteAccount(f.deps, USER, "DELETE")).rejects.toThrow();
    expect(f.calls).not.toContain(`delete:${USER}`);
  });

  it("keeps the account when the audit log cannot be written", async () => {
    const f = fakes();
    f.failAudit();
    await expect(deleteAccount(f.deps, USER, "DELETE")).rejects.toThrow();
    expect(f.calls).not.toContain(`delete:${USER}`);
  });

  it("records no event when the user could not be deleted", async () => {
    const f = fakes();
    f.failDelete();
    await expect(deleteAccount(f.deps, USER, "DELETE")).rejects.toThrow();
    expect(f.events).toEqual([]);
  });
});
