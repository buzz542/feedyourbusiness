import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { allowedSessionUser, type SessionUser } from "./session-user";

export type { SessionUser };

/**
 * The signed-in user, verified with Supabase Auth and the pre-launch allowlist, or null. Cached per
 * request, so the layout and the page share one call to Supabase Auth.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return allowedSessionUser(data.user);
});

/** The signed-in user, or a redirect to sign in that comes back to `returnTo`. */
export async function requireUser(returnTo: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return user;
}
