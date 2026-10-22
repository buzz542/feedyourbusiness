"use server";

import { redirect } from "next/navigation";
import { getAuthDeps } from "@/server/auth/deps";
import { acceptTerms } from "@/server/auth/sign-in";
import { requireAccount } from "@/server/auth/account";

export async function acceptTermsAction(form: FormData): Promise<void> {
  const account = await requireAccount("/app/terms");
  if (form.get("adult") !== "yes" || form.get("terms") !== "yes") redirect("/app/terms?error=1");
  const deps = getAuthDeps();
  await acceptTerms(deps.auth, account.userId, deps.now());
  redirect("/app");
}
