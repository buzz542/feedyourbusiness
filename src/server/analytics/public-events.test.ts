import { describe, expect, it } from "vitest";
import { recordPublicEvent } from "./public-events";
import type { EventRow, EventStore } from "./track";

/**
 * The homepage's two events (the founder's redesign brief): the primary CTA clicked, by placement,
 * and the example viewed. Visitors are not signed in, so no user and nothing else: a fixed name and
 * a fixed label.
 */

class Store implements EventStore {
  rows: EventRow[] = [];
  async insert(row: EventRow) {
    this.rows.push(row);
  }
}

describe("recordPublicEvent", () => {
  it("records a CTA click with its placement, and an example view, with no user", async () => {
    const store = new Store();
    expect(await recordPublicEvent(store, { name: "cta_clicked", placement: "hero" })).toBe(true);
    expect(await recordPublicEvent(store, { name: "example_viewed" })).toBe(true);
    expect(store.rows).toEqual([
      { name: "cta_clicked", userId: null, props: { placement: "hero" } },
      { name: "example_viewed", userId: null, props: {} },
    ]);
  });

  it("refuses another event, an unknown placement, extra fields or anything else", async () => {
    const store = new Store();
    for (const raw of [
      { name: "signed_up" },
      { name: "first_conversation_saved" },
      { name: "cta_clicked", placement: "footer" },
      { name: "cta_clicked" },
      { name: "example_viewed", placement: "hero" },
      { name: "example_viewed", email: "someone@example.test" },
      "example_viewed",
      null,
    ])
      expect(await recordPublicEvent(store, raw)).toBe(false);
    expect(store.rows).toEqual([]);
  });
});
