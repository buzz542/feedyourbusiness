"use server";

import { redirect } from "next/navigation";
import { createSupabaseEventStore } from "@/server/analytics/supabase-events";
import { track } from "@/server/analytics/track";
import { requireAppUser } from "@/server/auth/session";
import { draftFromInput } from "@/server/onboarding/draft";
import { parseEdits, type EditField } from "@/server/onboarding/review";
import {
  confirmDraft,
  createOnboardingDeps,
  loadOnboardingView,
  saveOnboardingEdits,
} from "@/server/onboarding/wiring";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { REFUSAL_MESSAGES } from "./messages";

const PATH = "/app/onboarding";

export type DraftState = { kind: "idle" } | { kind: "message"; text: string; input: string };

const FAILED: Record<string, string> = {
  limit:
    "That's the most drafts for today (retries count). Try again tomorrow, or change the draft by hand.",
  cap: "We can't draft for this product right now. Change the draft by hand, or contact us.",
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
export async function confirmAction(form: FormData): Promise<void> {
  const user = await requireAppUser(PATH);
  const client = await createSupabaseServerClient();
  const view = await loadOnboardingView(client, user.id);
  const seen = typeof form.get("seen") === "string" ? String(form.get("seen")) : "";
  // Only the version the user looked at, and never a product with no search terms.
  if (
    view?.product.status === "draft" &&
    view.terms.length > 0 &&
    seen &&
    (await confirmDraft(client, view.product.id, seen))
  ) {
    await track(createSupabaseEventStore(), "product_confirmed", user.id);
    redirect("/app");
  }
  redirect(PATH);
}

const EDIT_FIELDS = [
  "name",
  "one_liner",
  "description",
  "audience",
  "relevance_threshold",
  "terms",
  "competitors",
  "subreddits",
] as const;

export type EditState =
  | { kind: "idle" }
  | {
      kind: "invalid" | "error";
      errors: Partial<Record<EditField, string>>;
      /** What the user typed, so a refused save never wipes it (React resets the form). */
      values: Partial<Record<(typeof EDIT_FIELDS)[number], string>>;
    };

/** "Save and confirm" after edits under "Change something": one transaction, then the confirm. */
export async function saveAndConfirmAction(_prev: EditState, form: FormData): Promise<EditState> {
  const user = await requireAppUser(PATH);
  const values = Object.fromEntries(
    EDIT_FIELDS.map((k) => [k, typeof form.get(k) === "string" ? String(form.get(k)) : ""]),
  );
  const client = await createSupabaseServerClient();
  let view;
  try {
    view = await loadOnboardingView(client, user.id);
  } catch (error) {
    logError("load failed", error);
    return { kind: "error", errors: {}, values };
  }
  if (!view || view.product.status !== "draft") redirect("/app");
  const ownHost = view.product.url ? new URL(view.product.url).hostname : null;
  const parsed = parseEdits(form, ownHost);
  if (!parsed.ok) return { kind: "invalid", errors: parsed.errors, values };
  try {
    await saveOnboardingEdits(client, view.product.id, parsed.edits);
    if (await confirmDraft(client, view.product.id))
      await track(createSupabaseEventStore(), "product_confirmed", user.id);
  } catch (error) {
    logError("save failed", error);
    return { kind: "error", errors: {}, values };
  }
  redirect("/app");
}
