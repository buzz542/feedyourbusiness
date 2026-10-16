import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createAnthropicClient } from "./anthropic";
import { loadLlmConfig } from "./config";
import { createLlm, type Llm } from "./llm";
import { createSupabaseUsageStore } from "./supabase-usage";

/** The production wiring: Anthropic, `llm_usage` through the service-role client, the real clock. */
export function createServerLlm(): Llm {
  const { apiKey, caps } = loadLlmConfig();
  return createLlm({
    client: createAnthropicClient(apiKey),
    usage: createSupabaseUsageStore(createSupabaseAdminClient()),
    clock: () => new Date(),
    caps,
  });
}
