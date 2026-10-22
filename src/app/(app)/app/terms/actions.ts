"use server";

import { redirect } from "next/navigation";
import { getAuthDeps } from "@/server/auth/deps";
import { acceptTerms } from "@/server/auth/sign-in";
import { getSessionUser } from "@/server/auth/supabase-auth";

export async function acceptTermsAction(form: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=%2Fapp%2Fterms");
  if (form.get("adult") !== "yes" || form.get("terms") !== "yes") redirect("/app/terms?error=1");
  const deps = getAuthDeps();
  await acceptTerms(deps.auth, user.id, deps.now());
  redirect("/app");
}
