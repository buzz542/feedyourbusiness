import { describe, expect, it } from "vitest";
import { PUBLIC_EVENT_DAILY_CAP, recordPublicEvent, type PublicEventStore } from "./public-events";

/**
 * The homepage's two events (the founder's redesign brief): the primary CTA clicked, by placement,
 * and the example viewed. Visitors are not signed in, so no user and nothing else: a fixed name and
 * a fixed label, under a daily cap per name (record_public_event) so a script cannot flood them.
 */

const NOW = new Date("2026-11-27T12:00:00Z");

/** As record_public_event: a cap per name and UTC day. */
class Store implements PublicEventStore {
  rows: { name: string; props: Record<string, unknown> }[] = [];
  async record(name: string, props: Record<string, unknown>, _now: Date, cap: number) {
    if (this.rows.filter((r) => r.name === name).length >= cap) return false;
    this.rows.push({ name, props });
    return true;
  }
}

describe("recordPublicEvent", () => {
  it("records a CTA click with its placement, and an example view, and nothing more", async () => {
    const store = new Store();
    expect(await recordPublicEvent(store, { name: "cta_clicked", placement: "hero" }, NOW)).toBe(
      true,
    );
    expect(await recordPublicEvent(store, { name: "example_viewed" }, NOW)).toBe(true);
    expect(store.rows).toEqual([
      { name: "cta_clicked", props: { placement: "hero" } },
      { name: "example_viewed", props: {} },
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
      expect(await recordPublicEvent(store, raw, NOW)).toBe(false);
    expect(store.rows).toEqual([]);
  });

  it("stops at the daily cap, so posting in a loop cannot flood the table", async () => {
    const store = new Store();
    const cap = PUBLIC_EVENT_DAILY_CAP;
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(10_000);
    let accepted = 0;
    for (let i = 0; i < cap + 25; i++)
      if (await recordPublicEvent(store, { name: "example_viewed" }, NOW)) accepted++;
    expect(accepted).toBe(cap);
  });
});
