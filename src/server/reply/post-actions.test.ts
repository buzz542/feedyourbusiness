import { describe, expect, it, vi } from "vitest";
import { applyPostAction, type PostState, type PostStateStore } from "./post-actions";

const ID = "11111111-1111-4111-8111-111111111111";

function fakeStore(initial: PostState = "new") {
  const cards = new Map([
    [ID, { state: initial, source: "reddit", category: "wish", relevance: 80 }],
  ]);
  const store: PostStateStore = {
    async setState(id, to) {
      const card = cards.get(id);
      if (!card) return null;
      const from = card.state;
      card.state = to;
      return { from, source: card.source, category: card.category, relevance: card.relevance };
    },
  };
  return { store, cards };
}

describe("applyPostAction", () => {
  it.each([
    ["saved", "post_saved"],
    ["replied", "post_replied"],
    ["hidden", "post_hidden"],
  ] as const)("moves a card to %s and records %s", async (to, event) => {
    const { store, cards } = fakeStore();
    const onEvent = vi.fn(async () => undefined);
    expect(await applyPostAction(store, { id: ID, to }, onEvent)).toEqual({
      ok: true,
      from: "new",
      to,
    });
    expect(cards.get(ID)?.state).toBe(to);
    expect(onEvent).toHaveBeenCalledWith(event, {
      source: "reddit",
      category: "wish",
      relevance: 80,
    });
  });

  it("undo puts the card back without an event", async () => {
    const { store, cards } = fakeStore("replied");
    const onEvent = vi.fn(async () => undefined);
    expect(await applyPostAction(store, { id: ID, to: "new" }, onEvent)).toEqual({
      ok: true,
      from: "replied",
      to: "new",
    });
    expect(cards.get(ID)?.state).toBe("new");
    expect(onEvent).not.toHaveBeenCalled();
  });

  it.each([[{ id: "not-a-uuid", to: "saved" }], [{ id: ID, to: "deleted" }], [{ id: ID }], [null]])(
    "refuses bad input %j without touching the store",
    async (input) => {
      const { store, cards } = fakeStore();
      expect(await applyPostAction(store, input)).toEqual({ ok: false, reason: "invalid" });
      expect(cards.get(ID)?.state).toBe("new");
    },
  );

  it("reports a card that is not the user's (RLS returns nothing)", async () => {
    const { store } = fakeStore();
    expect(
      await applyPostAction(store, { id: "22222222-2222-4222-8222-222222222222", to: "saved" }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});
