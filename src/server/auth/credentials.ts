/**
 * Whether an account can come back without an email link: it has set a password. The flag is only a
 * routing hint (a person who sets it falsely just skips their own reminder), never a security
 * check; Supabase decides who may sign in.
 */

export const PASSWORD_SET_KEY = "password_set";

interface UserLike {
  user_metadata?: Record<string, unknown> | null;
}

export function canSignInAgain(user: UserLike): boolean {
  return user.user_metadata?.[PASSWORD_SET_KEY] === true;
}

/**
 * Supabase answers a sign-up for an email that already has an account with the user but no
 * identities, and sends nothing. Only that counts as "already an account"; an answer that does not
 * say is treated as a new account, so a new person is never refused by mistake.
 */
export function isRepeatSignUp(user: { identities?: unknown[] | null }): boolean {
  return Array.isArray(user.identities) && user.identities.length === 0;
}
