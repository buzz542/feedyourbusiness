"use server";

import { redirect } from "next/navigation";
import { createSupabaseEventStore } from "@/server/analytics/supabase-events";
import { track } from "@/server/analytics/track";
import { acceptTerms } from "@/server/auth/sign-in";
import { requireAppUser } from "@/server/auth/session";
import { createSupabaseTermsStore } from "@/server/auth/supabase-auth";

export type TermsState = { kind: "idle" } | { kind: "missing" } | { kind: "error" };

export async function acceptTermsAction(_prev: TermsState, form: FormData): Promise<TermsState> {
  const user = await requireAppUser("/app/terms", { beforeTerms: true });

  try {
    const result = await acceptTerms(await createSupabaseTermsStore(), user.id, {
      adult: form.get("adult") === "on",
      terms: form.get("terms") === "on",
    });
    if (result.kind === "missing") return { kind: "missing" };
    // Once per account: a second accept returns "already" and records nothing.
    if (result.kind === "accepted") await track(createSupabaseEventStore(), "signed_up", user.id);
  } catch (error) {
    console.error(
      `[auth] accept terms failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
    return { kind: "error" };
  }
  redirect("/app");
}
