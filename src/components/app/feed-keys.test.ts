import { describe, expect, it } from "vitest";
import { feedKeyAction, moveIndex, type KeyLike } from "./feed-keys";

/** Reply tab keys (docs/PLAN.md 4.4). The browser wiring runs in tests/e2e/reply.spec.ts. */

const key = (k: string, over: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target: { tagName: "BODY" },
  ...over,
});

describe("feedKeyAction", () => {
  it.each([
    ["j", "next"],
    ["k", "previous"],
    ["o", "open"],
    ["s", "save"],
    ["r", "replied"],
    ["h", "hide"],
    ["?", "help"],
  ])("%s is %s", (k, action) => {
    expect(feedKeyAction(key(k))).toBe(action);
  });

  it("leaves typing in a field, modifiers and other keys alone", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"])
      expect(feedKeyAction(key("j", { target: { tagName } }))).toBeNull();
    expect(
      feedKeyAction(key("s", { target: { tagName: "DIV", isContentEditable: true } })),
    ).toBeNull();
    expect(feedKeyAction(key("r", { metaKey: true }))).toBeNull();
    expect(feedKeyAction(key("s", { ctrlKey: true }))).toBeNull();
    expect(feedKeyAction(key("x"))).toBeNull();
    expect(feedKeyAction(key("J"))).toBeNull();
  });
});

describe("moveIndex", () => {
  it("starts at the first card going down and the last going up, and stops at the ends", () => {
    expect(moveIndex(-1, "next", 5)).toBe(0);
    expect(moveIndex(-1, "previous", 5)).toBe(4);
    expect(moveIndex(4, "next", 5)).toBe(4);
    expect(moveIndex(0, "previous", 5)).toBe(0);
    expect(moveIndex(2, "next", 5)).toBe(3);
    expect(moveIndex(0, "next", 0)).toBe(-1);
  });
});
