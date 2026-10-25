import "server-only";
import { createServerLlm } from "@/server/llm/deps";
import { fetchOwnSite } from "@/server/net/own-site";
import { createSourceFetch } from "@/server/net/source-fetch";
import { pageText } from "@/server/onboarding/page-text";
import { SOURCE_USER_AGENT } from "@/server/pipeline/config";
import { createSupabaseCollectStore } from "@/server/pipeline/supabase-collect";
import { authorHasher } from "@/server/privacy/author-hash";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { collectSources } from "@/sources/registry";
import { PREVIEW_SOURCES, type PreviewDeps } from "./preview";
import { createSupabasePreviewStore } from "./supabase-preview";

/**
 * Production wiring for the instant preview, or null when the model key is missing (F13) or the
 * preview is switched off with PREVIEW_ENABLED=false. Only Hacker News and Bluesky, and only when
 * their own kill switches are on.
 */
export function createServerPreviewDeps(env: NodeJS.ProcessEnv = process.env): PreviewDeps | null {
  if (env.PREVIEW_ENABLED === "false") return null;
  let llm;
  let hash;
  try {
    llm = createServerLlm();
    hash = authorHasher(env);
  } catch {
    return null;
  }
  const db = createSupabaseAdminClient();
  const collect = createSupabaseCollectStore(db);
  const cap = Number(env.PREVIEW_DAILY_CAP);
  return {
    llm,
    siteText: async (url) => {
      const page = await fetchOwnSite(url);
      return pageText(page.text, page.contentType);
    },
    sources: collectSources(env).filter((s) =>
      (PREVIEW_SOURCES as readonly string[]).includes(s.id),
    ),
    fetchFor: (source) => createSourceFetch(source),
    credential: (name) => env[name],
    hash,
    async suppressed(pairs) {
      const out = new Set<string>();
      for (const source of new Set(pairs.map((p) => p.source))) {
        const hashes = pairs.filter((p) => p.source === source).map((p) => p.authorHash);
        for (const h of await collect.suppressed(source, hashes)) out.add(`${source}|${h}`);
      }
      return out;
    },
    store: createSupabasePreviewStore(db),
    globalCap: Number.isInteger(cap) && cap > 0 ? cap : undefined,
    userAgent: SOURCE_USER_AGENT,
  };
}
