"use server";

import { redirect } from "next/navigation";
import { createSupabaseEventStore } from "@/server/analytics/supabase-events";
import { track } from "@/server/analytics/track";
import { requireAppUser } from "@/server/auth/session";
import { draftFromInput } from "@/server/onboarding/draft";
import { applyEdits, parseEdits, type EditField } from "@/server/onboarding/review";
import {
  confirmDraft,
  createOnboardingDeps,
  createSupabaseReviewStore,
  loadOnboardingView,
  snapshotOf,
} from "@/server/onboarding/wiring";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { REFUSAL_MESSAGES } from "./messages";

const PATH = "/app/onboarding";

export type DraftState = { kind: "idle" } | { kind: "message"; text: string; input: string };

const FAILED: Record<string, string> = {
  limit: "You've drafted six times today. Try again tomorrow, or change the draft by hand.",
  cap: "We can't draft right now. Try again tomorrow.",
  refusal: "We couldn't draft from that. Describe your product in a sentence or two.",
  invalid: "That draft didn't come out right. Try again.",
  unavailable: "That took too long on our side. Try again in a minute.",
};

const logError = (where: string, error: unknown) =>
  console.error(`[onboarding] ${where}: ${error instanceof Error ? error.name : "UnknownError"}`);

/** Paste one thing; we read the site (or the description) and draft everything (4.3 steps 2, 3). */
export async function draftAction(_prev: DraftState, form: FormData): Promise<DraftState> {
  const user = await requireAppUser(PATH);
  const input = typeof form.get("input") === "string" ? String(form.get("input")) : "";
  let result;
  try {
    result = await draftFromInput(user.id, input, createOnboardingDeps());
  } catch (error) {
    logError("draft failed", error);
    return { kind: "message", text: "Something went wrong. Try again.", input };
  }
  if (result.kind === "refused")
    return { kind: "message", text: REFUSAL_MESSAGES[result.reason], input };
  if (result.kind === "need_description")
    return {
      kind: "message",
      text: "We couldn't read that site. Describe your product in a sentence or two instead.",
      input: "",
    };
  if (result.kind === "failed") return { kind: "message", text: FAILED[result.reason]!, input };
  redirect(PATH);
}

/** "Looks right": one click confirms; the database stamps confirmed_at (4.3 step 5). */
export async function confirmAction(): Promise<void> {
  const user = await requireAppUser(PATH);
  const client = await createSupabaseServerClient();
  const view = await loadOnboardingView(client);
  if (view?.product.status === "draft" && (await confirmDraft(client, view.product.id)))
    await track(createSupabaseEventStore(), "product_confirmed", user.id);
  redirect("/app");
}

export type EditState =
  | { kind: "idle" }
  | { kind: "invalid"; errors: Partial<Record<EditField, string>> }
  | { kind: "error" };

/** "Save and confirm" after edits under "Change something". */
export async function saveAndConfirmAction(_prev: EditState, form: FormData): Promise<EditState> {
  const user = await requireAppUser(PATH);
  const parsed = parseEdits(form);
  if (!parsed.ok) return { kind: "invalid", errors: parsed.errors };
  const client = await createSupabaseServerClient();
  try {
    const view = await loadOnboardingView(client);
    if (view?.product.status === "draft") {
      await applyEdits(
        createSupabaseReviewStore(client, view.product.id),
        snapshotOf(view),
        parsed.edits,
      );
      if (await confirmDraft(client, view.product.id))
        await track(createSupabaseEventStore(), "product_confirmed", user.id);
    }
  } catch (error) {
    logError("save failed", error);
    return { kind: "error" };
  }
  redirect("/app");
}
