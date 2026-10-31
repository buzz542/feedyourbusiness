import { describe, expect, it } from "vitest";
import { parseAllowlist } from "@/server/auth/allowlist";
import { allowlistedProducts } from "./collectable";

/** docs/PLAN.md 12.10: before launch, only products of accounts on SIGNUP_ALLOWLIST are collected. */
describe("allowlistedProducts", () => {
  const rows = [
    { id: "p1", owner_id: "u1" },
    { id: "p2", owner_id: "u2" },
    { id: "p3", owner_id: "u3" },
  ];
  const emails: Record<string, string | null> = {
    u1: "maker@example.test",
    u2: "stranger@example.test",
    u3: null,
  };
  const emailOf = async (id: string) => emails[id] ?? null;

  it("keeps only owners on the allowlist; an owner with no email is never collected", async () => {
    const allowed = parseAllowlist("maker@example.test");
    expect(await allowlistedProducts(rows, emailOf, allowed)).toEqual(["p1"]);
  });

  it("collects nothing when the allowlist is empty", async () => {
    expect(await allowlistedProducts(rows, emailOf, parseAllowlist(""))).toEqual([]);
  });

  it("does not let a failed email lookup collect the product", async () => {
    const failing = async () => {
      throw new Error("lookup failed");
    };
    expect(await allowlistedProducts(rows, failing, parseAllowlist("maker@example.test"))).toEqual(
      [],
    );
  });
});
