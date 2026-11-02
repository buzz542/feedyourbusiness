"use server";

import { revalidatePath } from "next/cache";
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
    track: (name, userId) => track(createSupabaseEventStore(), name, userId),
  })(user.id, input);
  if (result.ok) revalidatePath("/app/reply");
  return result;
}
