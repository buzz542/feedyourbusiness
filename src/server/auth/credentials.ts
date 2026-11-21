/**
 * Whether an account can come back without an email link: it has set a password, or it signs in
 * with Google. The flag is only a routing hint (a person who sets it falsely just skips their own
 * reminder), never a security check; Supabase decides who may sign in.
 */

export const PASSWORD_SET_KEY = "password_set";

interface UserLike {
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: { provider?: unknown; providers?: unknown } | null;
}

export function canSignInAgain(user: UserLike): boolean {
  if (user.user_metadata?.[PASSWORD_SET_KEY] === true) return true;
  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers) && providers.includes("google")) return true;
  return user.app_metadata?.provider === "google";
}
