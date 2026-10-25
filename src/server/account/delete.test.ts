import { describe, expect, it } from "vitest";
import { deleteAccount, type DeleteAccountDeps } from "./delete";

function fake(status: string | null = "trialing") {
  const log: string[] = [];
  const deps: DeleteAccountDeps = {
    billing: async () => ({ subscriptionId: status ? "sub_1" : null, status }),
    cancelNow: async (id) => void log.push(`cancel:${id}`),
    deleteUser: async (id) => void log.push(`delete:${id}`),
    audit: async (e) => void log.push(`audit:${e.action}:${e.target}`),
    recordEvent: async () => void log.push("event:account_deleted"),
  };
  return { deps, log };
}

describe("account deletion", () => {
  it("cancels the subscription at once, deletes the user, and records it without the user id", async () => {
    const { deps, log } = fake();
    expect(await deleteAccount(deps, "u1", "DELETE")).toEqual({ ok: true });
    expect(log).toEqual([
      "cancel:sub_1",
      "audit:account_deleted:null",
      "delete:u1",
      "event:account_deleted",
    ]);
  });

  it.each(["past_due", "active", "unpaid"])("cancels a %s subscription too", async (status) => {
    const { deps, log } = fake(status);
    await deleteAccount(deps, "u1", "DELETE");
    expect(log[0]).toBe("cancel:sub_1");
  });

  it("does not call Stripe for a canceled or absent subscription", async () => {
    for (const status of ["canceled", null]) {
      const { deps, log } = fake(status);
      await deleteAccount(deps, "u1", "DELETE");
      expect(log.some((l) => l.startsWith("cancel"))).toBe(false);
    }
  });

  it.each(["", "delete", "DELETE ME", null, undefined])(
    "needs the typed word, not %j",
    async (word) => {
      const { deps, log } = fake();
      expect(await deleteAccount(deps, "u1", word)).toEqual({ ok: false, reason: "not_confirmed" });
      expect(log).toEqual([]);
    },
  );

  it("deletes nothing when Stripe cannot cancel", async () => {
    const { deps, log } = fake();
    deps.cancelNow = async () => {
      throw new Error("stripe down");
    };
    await expect(deleteAccount(deps, "u1", "DELETE")).rejects.toThrow();
    expect(log).toEqual([]);
  });
});
