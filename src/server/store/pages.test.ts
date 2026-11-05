import { describe, expect, it } from "vitest";
import { readAllPages } from "./pages";

describe("readAllPages", () => {
  const table = Array.from({ length: 2_345 }, (_, i) => i);

  it("reads every row across pages", async () => {
    const rows = await readAllPages(async (from, to) => table.slice(from, to + 1), 1000);
    expect(rows).toEqual(table);
  });

  it("is not cut short when the server returns fewer rows than asked (a lower max-rows)", async () => {
    const capped = async (from: number, to: number) =>
      table.slice(from, Math.min(to + 1, from + 300));
    expect(await readAllPages(capped, 1000)).toEqual(table);
  });

  it("stops at the limit", async () => {
    expect(
      await readAllPages(async (from, to) => table.slice(from, to + 1), 1000, 1500),
    ).toHaveLength(1500);
  });
});
