"use server";

import { redirect } from "next/navigation";
import { safeBack } from "@/lib/safe-back";
import { requirePage } from "@/server/auth/app-state";
import { createSupabaseEventSink } from "@/server/events/sink";
import { track } from "@/server/events/track";
import { applyPostAction } from "@/server/reply/post-actions";
import { createPostStateStore } from "@/server/reply/supabase-reply";
import { createSupabaseServerClient } from "@/server/supabase/server";

function withParam(url: string, key: string, value: string | null): string {
  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.delete(key);
  if (value) params.set(key, value);
  const q = params.toString();
  return q ? `${path}?${q}` : path!;
}

/** Save, Mark replied, Hide and Undo (docs/PLAN.md 4.4). Changes only the card's state. */
export async function setPostStateAction(formData: FormData): Promise<void> {
  const { user } = await requirePage("reply", "/app/reply");
  const back = safeBack(formData.get("back"));
  const store = createPostStateStore(await createSupabaseServerClient());
  const isUndo = formData.get("undo") === "1";
  const result = await applyPostAction(
    store,
    { id: formData.get("id"), to: formData.get("to") },
    // An Undo restores a state; it is not a new save, reply or hide.
    isUndo
      ? undefined
      : (name, props) => track(createSupabaseEventSink(), name, user.id, props, new Date()),
  );
  if (!result.ok) redirect(back);
  const id = String(formData.get("id"));
  redirect(withParam(back, "undo", isUndo ? null : `${id}.${result.from}.${result.to}`));
}
