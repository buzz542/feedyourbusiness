import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createAnthropicClient } from "./anthropic-adapter";
import { loadLlmConfig } from "./config";
import { createLlm, type Llm } from "./llm";
import { createSupabaseUsageStore } from "./supabase-usage";

let cached: Llm | undefined;

/** The wired wrapper. Built on first use, not at import time, so `next build` needs no secrets. */
export function getLlm(): Llm {
  cached ??= (() => {
    const config = loadLlmConfig();
    return createLlm({
      client: createAnthropicClient(config.apiKey),
      usage: createSupabaseUsageStore(createSupabaseAdminClient()),
      clock: () => new Date(),
      caps: config.caps,
    });
  })();
  return cached;
}
