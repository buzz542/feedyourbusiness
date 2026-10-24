import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const adminSchema = publicSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(1),
});

type Env = Readonly<Record<string, string | undefined>>;

export function loadSupabasePublicConfig(env: Env = process.env) {
  const parsed = publicSchema.safeParse(env);
  if (!parsed.success) throw new Error("Supabase public configuration is missing or invalid");
  return {
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function loadSupabaseAdminConfig(env: Env = process.env) {
  const parsed = adminSchema.safeParse(env);
  if (!parsed.success) throw new Error("Supabase admin configuration is missing or invalid");
  return {
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: parsed.data.SUPABASE_SECRET_KEY,
  };
}

/**
 * Options for the Supabase session cookies. No browser code reads them (there is no browser
 * client), so they are httpOnly, and Secure whenever the site is served over https.
 */
export function sessionCookieOptions(env: Env = process.env) {
  let secure = false;
  try {
    secure = new URL(env.NEXT_PUBLIC_SITE_URL ?? "").protocol === "https:";
  } catch {
    // No valid site URL: leave Secure off rather than lose the cookie on http.
  }
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
  };
}
