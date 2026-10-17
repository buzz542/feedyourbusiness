import "server-only";
import { createFakeDraftDeps, fakeServicesEnabled } from "@/server/e2e/fake-services";
import { createServerLlm } from "@/server/llm/deps";
import type { Llm } from "@/server/llm/llm";
import { fetchOwnSite } from "@/server/net/own-site";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { DraftDeps } from "./draft";
import type { ProfileStore } from "./profile";
import { createSupabaseDraftStore } from "./supabase-draft-store";
import { createSupabaseProfileStore } from "./supabase-profile-store";

/**
 * Production wiring for onboarding: the signed-in user's Supabase client, fetchOwnSite() and the
 * model wrapper, or the localhost E2E fakes when fakeServicesEnabled(). Null when no model key is
 * configured (F13), so the page can say drafting is unavailable.
 */
export async function createServerDraftDeps(userId: string): Promise<DraftDeps | null> {
  const store = createSupabaseDraftStore(await createSupabaseServerClient(), userId);
  if (fakeServicesEnabled()) return createFakeDraftDeps(store);
  let llm: Llm;
  try {
    llm = createServerLlm();
  } catch {
    return null;
  }
  return { llm, fetchSite: (url) => fetchOwnSite(url), store, clock: () => new Date() };
}

export async function createServerProfileStore(): Promise<ProfileStore> {
  return createSupabaseProfileStore(await createSupabaseServerClient());
}
