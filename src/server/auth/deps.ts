import "server-only";
import { z } from "zod";
import { loadAllowlist } from "./allowlist";
import { isLocalDevServer } from "./local-env";
import type { SignInDeps } from "./sign-in";
import { createSupabaseAccountAdmin, createSupabaseAuthGateway } from "./supabase-auth";

export class SiteUrlError extends Error {
  override name = "SiteUrlError";
}

/** NEXT_PUBLIC_SITE_URL without a trailing slash. Read per request, so the build needs no env. */
export function loadSiteUrl(env: Readonly<Record<string, string | undefined>> = process.env) {
  const parsed = z.url().safeParse(env.NEXT_PUBLIC_SITE_URL);
  if (!parsed.success) throw new SiteUrlError("NEXT_PUBLIC_SITE_URL is missing or invalid");
  return parsed.data.replace(/\/+$/, "");
}

export async function getSignInDeps(): Promise<SignInDeps> {
  return {
    auth: await createSupabaseAuthGateway(),
    admin: createSupabaseAccountAdmin(),
    isAllowed: loadAllowlist(),
    siteUrl: loadSiteUrl(),
    now: () => new Date(),
    allowEmailTokenHash: isLocalDevServer(process.env),
  };
}
