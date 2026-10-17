"use server";

import { requirePage } from "@/server/auth/app-state";
import { createSupabaseEventSink } from "@/server/events/sink";
import { track } from "@/server/events/track";
import type { OwnSiteErrorCode } from "@/server/net/own-site-error";
import { createServerDraftDeps, createServerProfileStore } from "@/server/onboarding/deps";
import {
  draftFromDescription,
  draftFromUrl,
  type DraftFailure,
  type DraftResult,
} from "@/server/onboarding/draft";
import { confirmProfile, saveProfile, type ProfileResult } from "@/server/onboarding/profile";

/** Onboarding steps 2 to 5 (docs/PLAN.md 4.3). Every action checks the page's gate first. */

const PAGE = "/app/onboarding";

export type DraftActionResult =
  | { ok: true }
  | {
      ok: false;
      /** "unavailable": no model key is configured yet (F13). */
      reason: DraftFailure["reason"] | "unavailable";
      siteError?: OwnSiteErrorCode;
    };

/** The result without the draft itself: the page reloads and reads the saved draft. */
function summarize(result: DraftResult): DraftActionResult {
  if (result.ok) return { ok: true };
  return result.reason === "site_unreachable"
    ? { ok: false, reason: result.reason, siteError: result.siteError }
    : { ok: false, reason: result.reason };
}

export async function draftFromUrlAction(url: unknown): Promise<DraftActionResult> {
  const { user } = await requirePage("onboarding", PAGE);
  const deps = await createServerDraftDeps(user.id);
  if (!deps) return { ok: false, reason: "unavailable" };
  return summarize(await draftFromUrl(typeof url === "string" ? url : "", deps));
}

export async function draftFromDescriptionAction(input: unknown): Promise<DraftActionResult> {
  const { user } = await requirePage("onboarding", PAGE);
  const deps = await createServerDraftDeps(user.id);
  if (!deps) return { ok: false, reason: "unavailable" };
  const { url, description } = (input ?? {}) as { url?: unknown; description?: unknown };
  return summarize(
    await draftFromDescription(
      {
        url: typeof url === "string" ? url : "",
        description: typeof description === "string" ? description : "",
      },
      deps,
    ),
  );
}

const NO_PRODUCT: ProfileResult = {
  ok: false,
  errors: { form: "There is no draft to save yet. Start from your URL." },
};

export async function saveProfileAction(input: unknown): Promise<ProfileResult> {
  const { state } = await requirePage("onboarding", PAGE);
  if (!state.product) return NO_PRODUCT;
  const store = await createServerProfileStore();
  return saveProfile(state.product.id, input, { store });
}

export async function confirmProfileAction(input: unknown): Promise<ProfileResult> {
  const { user, state } = await requirePage("onboarding", PAGE);
  if (!state.product) return NO_PRODUCT;
  const store = await createServerProfileStore();
  const result = await confirmProfile(state.product.id, input, {
    store,
    onConfirmed: async (counts) => {
      await track(createSupabaseEventSink(), "product_confirmed", user.id, counts, new Date());
    },
  });
  // On success the page moves on to /app, which sends the user to the next step (the trial, 4.3).
  return result;
}
