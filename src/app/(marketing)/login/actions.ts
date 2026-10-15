"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authCallbackUrl, requestMagicLink, type MagicLinkResult } from "@/server/auth/sign-in";
import { createMagicLinkPort } from "@/server/auth/supabase-auth";
import { createSupabaseServerClient } from "@/server/supabase/server";

export type LoginState = MagicLinkResult | { status: "idle" };

/**
 * The origin to send people back to. Next has already checked that a server action's Origin matches
 * its Host, and Supabase only redirects to the URLs allowed in its settings, so this is safe on
 * production, previews and localhost alike.
 */
async function requestOrigin(): Promise<string> {
  const origin = (await headers()).get("origin");
  return origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
}

export async function sendMagicLinkAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const supabase = await createSupabaseServerClient();
  return requestMagicLink(
    { auth: createMagicLinkPort(supabase), siteUrl: await requestOrigin(), env: process.env },
    { email: String(formData.get("email") ?? ""), next: String(formData.get("next") ?? "") },
  );
}

export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: authCallbackUrl(await requestOrigin(), String(formData.get("next") ?? "")),
    },
  });
  if (error || !data.url) {
    console.error(`[auth] google sign-in failed: ${error?.name ?? "NoUrl"}`);
    redirect("/login?error=google");
  }
  redirect(data.url);
}
