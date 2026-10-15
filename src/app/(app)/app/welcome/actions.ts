"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { createTermsStore } from "@/server/auth/supabase-auth";
import { acceptTerms } from "@/server/auth/terms";
import { createSupabaseServerClient } from "@/server/supabase/server";

export async function acceptTermsAction(formData: FormData): Promise<void> {
  const user = await requireUser("/app/welcome");
  const store = createTermsStore(await createSupabaseServerClient());
  const result = await acceptTerms(
    store,
    user.id,
    { adult: formData.get("adult") ?? undefined, terms: formData.get("terms") ?? undefined },
    new Date(),
  );
  if (!result.ok) redirect("/app/welcome?error=confirm");
  redirect("/app");
}
