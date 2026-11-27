"use server";

import { after } from "next/server";
import { track } from "@/server/analytics/track";
import { createSupabaseEventStore } from "@/server/analytics/supabase-events";
import { requireAppUser } from "@/server/auth/session";
import { createPostStateAction } from "@/server/reply/post-state";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** Save, Mark replied, Hide and Undo (docs/PLAN.md 4.4): `state` only, through the user's client. */
export async function setPostState(input: {
  id: string;
  state: "new" | "saved" | "replied" | "hidden";
}): Promise<{ ok: boolean }> {
  const user = await requireAppUser("/app/reply");
  const supabase = await createSupabaseServerClient();
  const result = await createPostStateAction({
    async setState(id, state) {
      const { data, error } = await supabase
        .from("product_posts")
        .update({ state })
        .eq("id", id)
        .select("id");
      return !error && (data?.length ?? 0) === 1;
    },
    // A user's first save is recorded after the response: after the first, every save would
    // otherwise wait on an insert the database refuses as already recorded.
    track: async (name, userId) => {
      if (name === "first_conversation_saved")
        after(() => track(createSupabaseEventStore(), name, userId).then(() => undefined));
      else await track(createSupabaseEventStore(), name, userId);
    },
  })(user.id, input);
  // No revalidation: the card stays on screen with its Undo; the next visit reads the new state.
  return result;
}

/**
 * A user's first opened conversation (the founder's redesign brief): recorded once, by the
 * database (events_first_once); later calls change nothing. No post id or text is recorded.
 */
export async function markConversationOpened(): Promise<void> {
  const user = await requireAppUser("/app/reply");
  await track(createSupabaseEventStore(), "first_conversation_opened", user.id);
}
