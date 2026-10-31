import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createAnthropicClientFromEnv } from "./anthropic-client";
import { loadSpendCaps } from "./config";
import { createLlm, type Llm } from "./llm";
import { createSupabaseUsageStore } from "./supabase-usage";

export {
  LlmCapError,
  LlmRefusalError,
  LlmSchemaError,
  LlmUnavailableError,
  NEVER_INFER,
} from "./llm";
export type { Llm, SpendCap } from "./llm";

/** The wired wrapper: Anthropic, llm_usage through the service role, the system clock. */
export function createLlmFromEnv(): Llm {
  return createLlm({
    client: createAnthropicClientFromEnv(),
    usage: createSupabaseUsageStore(createSupabaseAdminClient()),
    clock: { now: () => new Date() },
    caps: loadSpendCaps(),
  });
}
