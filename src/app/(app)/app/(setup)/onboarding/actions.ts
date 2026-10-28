"use server";

import { redirect } from "next/navigation";
import { createSupabaseEventStore } from "@/server/analytics/supabase-events";
import { track } from "@/server/analytics/track";
import { requireAppUser } from "@/server/auth/session";
import { getOnboarding, getOnboardingStore } from "@/server/onboarding/deps";
import { submitReview, type ReviewOutcome } from "@/server/onboarding/review";
import type { DraftOutcome } from "@/server/onboarding/service";

const PATH = "/app/onboarding";

export type DraftState =
  { kind: "idle"; url: string } | (Exclude<DraftOutcome, { kind: "saved" }> & { url: string });

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : null;
};

/** Steps 2 and 3 (docs/PLAN.md 4.3): draft from the product URL, or from a pasted description. */
export async function draftAction(_prev: DraftState, form: FormData): Promise<DraftState> {
  const user = await requireAppUser(PATH);
  const url = (text(form, "url") ?? "").slice(0, 4096);
  const description = text(form, "description");
  const onboarding = await getOnboarding();
  const outcome =
    description === null
      ? await onboarding.draftFromUrl(user.id, url)
      : await onboarding.draftFromDescription(user.id, url, description.slice(0, 20_000));
  if (outcome.kind === "saved") redirect(PATH);
  return { ...outcome, url };
}

export type ReviewState = { kind: "idle" } | Exclude<ReviewOutcome, { kind: "confirmed" }>;

/** Steps 4 and 5: save the owner's edits, or save and confirm. */
export async function reviewAction(_prev: ReviewState, form: FormData): Promise<ReviewState> {
  const user = await requireAppUser(PATH);
  const intent = text(form, "intent") === "confirm" ? "confirm" : "save";
  const outcome = await submitReview(await getOnboardingStore(), user.id, form, intent, new Date());
  if (outcome.kind === "confirmed") {
    await track(createSupabaseEventStore(), "product_confirmed", user.id);
    redirect("/app");
  }
  return outcome;
}
