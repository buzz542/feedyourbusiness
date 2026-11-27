import { describe, expect, it } from "vitest";
import type { EventName } from "@/server/analytics/track";
import { createPostStateAction } from "./post-state";

/**
 * Save, Mark replied, Hide and Undo (docs/PLAN.md 4.4), and the events each records: the state's
 * own event, and a user's first save (the founder's redesign brief), which the database keeps to
 * one per user.
 */

const USER = "00000000-0000-4000-8000-0000000000a1";
const ID = "00000000-0000-4000-8000-000000000001";

function setup(ok = true) {
  const events: EventName[] = [];
  const action = createPostStateAction({
    setState: async () => ok,
    track: async (name) => void events.push(name),
  });
  return { events, action };
}

describe("createPostStateAction", () => {
  it("records a save, and asks for the first-save event too", async () => {
    const { events, action } = setup();
    expect(await action(USER, { id: ID, state: "saved" })).toEqual({ ok: true });
    expect(events).toEqual(["post_saved", "first_conversation_saved"]);
  });

  it("records hide and replied without a first-save event, and nothing for undo to new", async () => {
    const { events, action } = setup();
    await action(USER, { id: ID, state: "hidden" });
    await action(USER, { id: ID, state: "replied" });
    await action(USER, { id: ID, state: "new" });
    expect(events).toEqual(["post_hidden", "post_replied"]);
  });

  it("records nothing when the change was refused or the input is wrong", async () => {
    const refused = setup(false);
    expect(await refused.action(USER, { id: ID, state: "saved" })).toEqual({ ok: false });
    expect(refused.events).toEqual([]);
    const bad = setup();
    expect(await bad.action(USER, { id: "x", state: "saved" })).toEqual({ ok: false });
    expect(bad.events).toEqual([]);
  });
});
