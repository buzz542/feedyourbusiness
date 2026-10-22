import "server-only";
import { z } from "zod";
import { parseAllowlist, type Allowlist } from "./allowlist";
import type { AuthPort, TermsStore } from "./ports";
import { createSupabaseAuth } from "./supabase-auth";

export interface AuthDeps {
  auth: AuthPort & TermsStore;
  allowlist: Allowlist;
  siteUrl: string;
  now: () => Date;
}

const SiteUrl = z.url({ protocol: /^https?$/ });

/** Built per request so `next build` needs no secrets and env changes apply on the next request. */
export function getAuthDeps(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthDeps {
  const siteUrl = SiteUrl.parse(env.NEXT_PUBLIC_SITE_URL);
  return {
    auth: createSupabaseAuth(),
    allowlist: parseAllowlist(env.SIGNUP_ALLOWLIST),
    siteUrl,
    now: () => new Date(),
  };
}
