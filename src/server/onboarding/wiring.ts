import "server-only";
import { createLlm } from "@/server/llm/llm";
import { createAnthropicClientFromEnv } from "@/server/llm/anthropic-client";
import { loadSpendCaps } from "@/server/llm/config";
import { createSupabaseUsageStore } from "@/server/llm/supabase-usage";
import { fetchOwnSite } from "@/server/net/own-site";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/types/database";
import type { OnboardingDeps } from "./draft";
import { fakeFetchPage, fakeLlmClient, fakeServicesAllowed } from "./fake-services";
import type { Edits } from "./review";
import { createSupabaseDraftStore } from "./supabase-draft-store";

/**
 * Onboarding's dependencies. The draft runs as the service role after the page has checked the
 * session (start_product_draft and save_product_draft are server-only); review edits run as the
 * signed-in user, so RLS and column grants apply. With E2E_FAKE_SERVICES on a local run only, the
 * model and the site are fakes; the database is real.
 */
export function createOnboardingDeps(): OnboardingDeps {
  const fake = fakeServicesAllowed();
  const admin = createSupabaseAdminClient();
  const usage = createSupabaseUsageStore(admin);
  const clock = { now: () => new Date() };
  return {
    llm: createLlm({
      client: fake ? fakeLlmClient : createAnthropicClientFromEnv(),
      usage,
      clock,
      caps: loadSpendCaps(),
    }),
    usage,
    store: createSupabaseDraftStore(admin),
    clock,
    reader: { fetchPage: fake ? fakeFetchPage : fetchOwnSite, now: () => Date.now() },
  };
}

export interface OnboardingView {
  product: {
    id: string;
    url: string | null;
    name: string;
    one_liner: string | null;
    description: string | null;
    audience: string | null;
    subreddits: string[];
    relevance_threshold: number;
    status: string;
    updated_at: string;
  };
  terms: { id: string; term: string }[];
  competitors: { id: string; name: string; domain: string | null; aliases: string[] }[];
}

type UserClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

class OnboardingReadError extends Error {
  override name = "OnboardingReadError";
}

/** The owner's product with its terms and competitors, read through RLS. Null before a draft. */
export async function loadOnboardingView(
  client: UserClient,
  ownerId: string,
): Promise<OnboardingView | null> {
  const { data: product, error } = await client
    .from("products")
    .select(
      "id, url, name, one_liner, description, audience, subreddits, relevance_threshold, status, updated_at",
    )
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new OnboardingReadError();
  if (!product) return null;
  const [terms, competitors] = await Promise.all([
    client.from("search_terms").select("id, term").eq("product_id", product.id).order("created_at"),
    client
      .from("competitors")
      .select("id, name, domain, aliases")
      .eq("product_id", product.id)
      .order("created_at"),
  ]);
  if (terms.error || competitors.error) throw new OnboardingReadError();
  return { product, terms: terms.data, competitors: competitors.data };
}

class OnboardingWriteError extends Error {
  override name = "OnboardingWriteError";
}

/** "Change something": every edit in one transaction, as the owner (apply_onboarding_edits). */
export async function saveOnboardingEdits(
  client: UserClient,
  productId: string,
  edits: Edits,
): Promise<void> {
  const { error } = await client.rpc("apply_onboarding_edits", {
    p_product_id: productId,
    p_profile: edits.profile as unknown as Json,
    p_terms: edits.terms,
    p_competitors: edits.competitors as unknown as Json,
  });
  if (error) throw new OnboardingWriteError();
}

/**
 * "Looks right": the draft becomes active, and the database stamps confirmed_at. With `seen`, only
 * the version the user looked at (its updated_at), so a redraft or edit in another tab is never
 * confirmed unseen.
 */
export async function confirmDraft(
  client: UserClient,
  productId: string,
  seen?: string,
): Promise<boolean> {
  let query = client
    .from("products")
    .update({ status: "active" })
    .eq("id", productId)
    .eq("status", "draft");
  if (seen) query = query.eq("updated_at", seen);
  const { data, error } = await query.select("id");
  if (error) throw new OnboardingWriteError();
  return (data ?? []).length === 1;
}
