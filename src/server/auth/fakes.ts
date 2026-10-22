import type { AuthPort, AuthUser, TermsStore } from "./ports";

interface Pending {
  email: string;
  createdAt: Date;
}

/** In-memory auth for tests. Verifying a code creates the user, as Supabase does. */
export function createFakeAuth(opts: { failSend?: boolean } = {}) {
  const users = new Map<string, AuthUser>();
  const profiles = new Map<string, { termsAcceptedAt: Date | null }>();
  const pendingCodes = new Map<string, Pending>();
  const pendingTokens = new Map<string, Pending>();
  const magicLinks: { email: string; redirectTo: string }[] = [];
  const oauthRedirects: string[] = [];
  let seq = 0;

  const state = { signedIn: false };

  const signInAs = (p: Pending): AuthUser => {
    const existing = [...users.values()].find((u) => u.email === p.email);
    const user = existing ?? { id: `user-${++seq}`, email: p.email, createdAt: p.createdAt };
    users.set(user.id, user);
    if (!profiles.has(user.id)) profiles.set(user.id, { termsAcceptedAt: null });
    state.signedIn = true;
    return user;
  };

  const auth: AuthPort & TermsStore = {
    async sendMagicLink(email, redirectTo) {
      if (opts.failSend) throw new Error("send failed for someone@example.test");
      magicLinks.push({ email, redirectTo });
    },
    async googleSignInUrl(redirectTo) {
      oauthRedirects.push(redirectTo);
      return `https://accounts.example.test/o/oauth2?redirect=${encodeURIComponent(redirectTo)}`;
    },
    async exchangeCode(code) {
      const p = pendingCodes.get(code);
      return p ? signInAs(p) : null;
    },
    async verifyTokenHash(tokenHash: string) {
      const p = pendingTokens.get(tokenHash);
      return p ? signInAs(p) : null;
    },
    async signOut() {
      state.signedIn = false;
    },
    async deleteUser(userId) {
      users.delete(userId);
      profiles.delete(userId);
    },
    async acceptTerms(userId, now) {
      const p = profiles.get(userId);
      if (!p || p.termsAcceptedAt) return false;
      p.termsAcceptedAt = now;
      return true;
    },
  };

  const fake = Object.assign(auth, {
    users,
    profiles,
    pendingCodes,
    pendingTokens,
    magicLinks,
    oauthRedirects,
    signedIn: false,
  });
  Object.defineProperty(fake, "signedIn", { get: () => state.signedIn });
  return fake;
}
