import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { loadSupabasePublicConfig } from "./config";

/** User-scoped client for server components and route handlers. Row-level security applies. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = loadSupabasePublicConfig();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to ignore: the
          // session is refreshed wherever cookies are writable.
        }
      },
    },
  });
}
