"use server";

import { redirect } from "next/navigation";
import { requirePage } from "@/server/auth/app-state";
import { createTermsStore } from "@/server/auth/supabase-auth";
import { acceptTerms } from "@/server/auth/terms";
import { createSupabaseEventSink } from "@/server/events/sink";
import { track } from "@/server/events/track";
import { createSupabaseServerClient } from "@/server/supabase/server";

export async function acceptTermsAction(formData: FormData): Promise<void> {
  const { user } = await requirePage("welcome", "/app/welcome");
  const store = createTermsStore(await createSupabaseServerClient());
  const result = await acceptTerms(
    store,
    user.id,
    { adult: formData.get("adult") ?? undefined, terms: formData.get("terms") ?? undefined },
    new Date(),
    () => track(createSupabaseEventSink(), "signed_up", user.id, {}, new Date()),
  );
  if (!result.ok) redirect("/app/welcome?error=confirm");
  redirect("/app");
}
