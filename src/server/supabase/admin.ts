import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadSupabaseAdminConfig } from "./config";

export type AdminClient = SupabaseClient<Database>;

/**
 * Service-role client. Bypasses row-level security, so it may only be used in trusted server
 * code (webhooks, cron, admin actions) and never imported from client components. Every use that
 * changes data on a person's behalf belongs in the audit log.
 */
export function createSupabaseAdminClient(): AdminClient {
  const { url, secretKey } = loadSupabaseAdminConfig();
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
