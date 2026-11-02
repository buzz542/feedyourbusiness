import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { loadAllowlist } from "@/server/auth/allowlist";
import { collectSources } from "@/sources/registry";
import { createClassifier } from "@/server/classify/classifier";
import { createSpendCapCheck } from "@/server/classify/spend";
import { createSupabaseProfileStore } from "@/server/classify/supabase-profiles";
import { createDigestHandler } from "@/server/email/digest";
import { createResendMailer } from "@/server/email/mailer";
import { createSupabaseDigestStore } from "@/server/email/supabase-digest";
import { createLlmFromEnv, type Llm } from "@/server/llm";
import { loadSpendCaps } from "@/server/llm/config";
import { createSupabaseUsageStore } from "@/server/llm/supabase-usage";
import { authorHasher, type AuthorHasher } from "@/server/privacy/author-hash";
import { createSourceFetch } from "@/server/net/source-fetch";
import { allowlistedProducts } from "./collectable";
import { createCollectHandler } from "./collect";
import { createCollectStep } from "./collect-step";
import { costPerUnitFor, dailyBudgetFor, monthlyCapFor, SOURCE_USER_AGENT } from "./config";
import { createPurgeHandler, type CronDeps } from "./cron";
import { createDeletionSyncHandler } from "./deletion-sync";
import {
  collectTermsFor,
  createOwnerEmailLookup,
  createSupabaseCollectStore,
  createSupabaseDeletionStore,
  recheckProducts,
} from "./supabase-collect";
import {
  collectableRows,
  createSupabaseBudgetStore,
  createSupabaseJobStore,
  purgeExpired,
} from "./supabase-jobs";

/**
 * The cron routes' dependencies (docs/PLAN.md 7.2, 13). Only kinds with a handler are enqueued, so
 * a kind is switched on here when its step exists: purge, deletion sync, collect, the first run and
 * the daily email now; synthesis and the Monday digest with their milestones. Every collect source
 * is off by default, so collect and deletion sync have nothing to do until one is switched on. The
 * model client, the author pepper, the spend caps and the mailer are read on first use, so a
 * missing key never stops the purge.
 */
export function createServerCronDeps(): CronDeps {
  const admin = createSupabaseAdminClient();
  const sources = collectSources();
  const ownerEmail = createOwnerEmailLookup(admin);
  const allowed = async (row: { id: string; owner_id: string }) =>
    (await allowlistedProducts([row], ownerEmail, loadAllowlist())).length > 0;
  const sourceFor = (id: string) => collectSources().find((s) => s.id === id) ?? null;

  let llm: Llm | undefined;
  let hasher: AuthorHasher | undefined;
  const classifier = createClassifier({
    llm: { callStructured: (call) => (llm ??= createLlmFromEnv()).callStructured(call) },
    profiles: createSupabaseProfileStore(admin),
  });
  const usage = createSupabaseUsageStore(admin);
  // Read when a collect job runs, so a bad cap value never stops the purge or deletion sync.
  const spendCap = (productId: string) =>
    createSpendCapCheck({ usage, caps: loadSpendCaps(), clock: { now: () => new Date() } })(
      productId,
    );
  const ready = () => {
    if (!process.env.ANTHROPIC_API_KEY) return "ModelKeyMissing";
    try {
      hasher ??= authorHasher();
    } catch {
      return "AuthorPepperMissing";
    }
    return null;
  };
  const budget = createSupabaseBudgetStore(admin);

  const collectHandler = createCollectHandler({
    sourceFor,
    // Each source's own fetch, bound to its own hosts (2.1.9), never the combined safeFetch.
    fetchFor: (source) => createSourceFetch(source),
    budget,
    terms: (productId, source) => collectTermsFor(admin, productId, source.id, allowed),
    process: createCollectStep({
      store: createSupabaseCollectStore(admin),
      classifier,
      hash: (source, key) => (hasher ??= authorHasher())(source, key),
    }),
    spendCap,
    ready,
    monthlyCap: (source) => monthlyCapFor(source),
    budgetFor: (source) => dailyBudgetFor(source),
    costFor: (source) => costPerUnitFor(source),
    userAgent: SOURCE_USER_AGENT,
  });

  return {
    store: createSupabaseJobStore(admin),
    handlers: {
      purge: createPurgeHandler((now) => purgeExpired(admin, now)),
      collect: collectHandler,
      // The first run after checkout is a collect job with a 7-day window and twice the budget.
      first_run: collectHandler,
      digest_daily: createDigestHandler({
        store: createSupabaseDigestStore(admin),
        mailer: () => {
          try {
            return createResendMailer();
          } catch {
            return null;
          }
        },
        siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL ?? "",
        secret: () => process.env.APP_HMAC_SECRET,
      }),
      // Deletion sync needs no model: Hacker News and Bluesky existence checks, X lookups (its
      // deletion compliance) and the Reddit re-check.
      deletion_sync: createDeletionSyncHandler({
        sourceFor,
        fetchFor: (source) => createSourceFetch(source),
        store: createSupabaseDeletionStore(admin),
        budget,
        recheckCap: (source) => monthlyCapFor(source, process.env, "recheck"),
        costFor: (source) => costPerUnitFor(source),
        userAgent: SOURCE_USER_AGENT,
      }),
    },
    recheckProducts: (from, to) => recheckProducts(admin, from, to),
    // Before launch, only accounts on SIGNUP_ALLOWLIST (12.10).
    products: async () =>
      allowlistedProducts(await collectableRows(admin), ownerEmail, loadAllowlist()),
    sources,
    clock: () => new Date(),
  };
}
