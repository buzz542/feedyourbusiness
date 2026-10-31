import "server-only";
import { createLlm } from "@/server/llm/llm";
import { createAnthropicClientFromEnv } from "@/server/llm/anthropic-client";
import { loadSpendCaps } from "@/server/llm/config";
import { createSupabaseUsageStore } from "@/server/llm/supabase-usage";
import { fetchOwnSite } from "@/server/net/own-site";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { OnboardingDeps } from "./draft";
import { fakeFetchPage, fakeLlmClient, fakeServicesAllowed } from "./fake-services";
import type { ReviewSnapshot, ReviewStore } from "./review";
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
  };
  terms: { id: string; term: string }[];
  competitors: { id: string; name: string; domain: string | null; aliases: string[] }[];
}

type UserClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

class OnboardingReadError extends Error {
  override name = "OnboardingReadError";
}

/** The owner's product with its terms and competitors, read through RLS. Null before a draft. */
export async function loadOnboardingView(client: UserClient): Promise<OnboardingView | null> {
  const { data: product, error } = await client
    .from("products")
    .select(
      "id, url, name, one_liner, description, audience, subreddits, relevance_threshold, status",
    )
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

export const snapshotOf = (view: OnboardingView): ReviewSnapshot => ({
  terms: view.terms,
  competitors: view.competitors.map(({ id, name, domain }) => ({ id, name, domain })),
});

class OnboardingWriteError extends Error {
  override name = "OnboardingWriteError";
}

const check = ({ error }: { error: unknown }) => {
  if (error) throw new OnboardingWriteError();
};

/** Review edits through the user's own client: owner only, permitted columns only. */
export function createSupabaseReviewStore(client: UserClient, productId: string): ReviewStore {
  return {
    async updateProfile(profile) {
      check(
        await client.from("products").update(profile).eq("id", productId).eq("status", "draft"),
      );
    },
    async addTerms(terms) {
      check(
        await client.from("search_terms").upsert(
          terms.map((term) => ({ product_id: productId, term })),
          { onConflict: "product_id,term", ignoreDuplicates: true },
        ),
      );
    },
    async removeTerms(ids) {
      check(await client.from("search_terms").delete().eq("product_id", productId).in("id", ids));
    },
    async addCompetitors(competitors) {
      check(
        await client.from("competitors").upsert(
          competitors.map((c) => ({ product_id: productId, name: c.name, domain: c.domain })),
          { onConflict: "product_id,name_key", ignoreDuplicates: true },
        ),
      );
    },
    async updateCompetitorDomain(id, domain) {
      check(
        await client
          .from("competitors")
          .update({ domain })
          .eq("product_id", productId)
          .eq("id", id),
      );
    },
    async removeCompetitors(ids) {
      check(await client.from("competitors").delete().eq("product_id", productId).in("id", ids));
    },
  };
}

/** "Looks right": the draft becomes active, and the database stamps confirmed_at. */
export async function confirmDraft(client: UserClient, productId: string): Promise<boolean> {
  const { data, error } = await client
    .from("products")
    .update({ status: "active" })
    .eq("id", productId)
    .eq("status", "draft")
    .select("id");
  if (error) throw new OnboardingWriteError();
  return (data ?? []).length === 1;
}
