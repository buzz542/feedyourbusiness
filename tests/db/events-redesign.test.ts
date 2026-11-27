import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withRole } from "./harness";

/**
 * Migration `events_redesign` (the founder's redesign brief, 27 Nov 2026: measurement through the
 * existing first-party events table only). It allows four more names: the primary CTA clicked and
 * the example viewed (no user: the visitor is not signed in), and a user's first conversation
 * opened and first conversation saved, which the database keeps to one each per user. Nothing else
 * about the table changes: still deny-all for API roles.
 */

const ALICE = "00000000-0000-4000-8000-0000000000a1";

describe("events after events_redesign", () => {
  let db: PGlite;
  const insert = (name: string, userId: string | null = null, props = "{}") =>
    withRole(db, "service_role", null, () =>
      db.query("insert into public.events (user_id, name, props) values ($1, $2, $3::jsonb)", [
        userId,
        name,
        props,
      ]),
    );

  beforeAll(async () => {
    db = await createDb();
    await db.query("insert into auth.users (id) values ($1)", [ALICE]);
  });
  afterAll(() => db.close());

  it("accepts the four new names", async () => {
    await insert("cta_clicked", null, '{"placement":"hero"}');
    await insert("example_viewed");
    await insert("first_conversation_opened", ALICE);
    await insert("first_conversation_saved", ALICE);
  });

  it("still refuses a name it does not know", async () => {
    await expect(insert("page_viewed")).rejects.toThrow(/check constraint/);
  });

  it("keeps one first-conversation event of each kind per user", async () => {
    await expect(insert("first_conversation_opened", ALICE)).rejects.toThrow(/duplicate key/);
    await expect(insert("first_conversation_saved", ALICE)).rejects.toThrow(/duplicate key/);
    // Other events repeat as before.
    await insert("post_saved", ALICE);
    await insert("post_saved", ALICE);
    await insert("cta_clicked", null, '{"placement":"nav"}');
  });

  it("is still invisible to signed-in users", async () => {
    await expect(
      withRole(db, "authenticated", ALICE, () => db.query("select * from public.events")),
    ).rejects.toThrow(/permission denied/);
  });
});
