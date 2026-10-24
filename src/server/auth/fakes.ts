import type { AccountAdmin, AuthGateway, AuthUser, TermsStore } from "./ports";

/** In-memory test doubles for the auth ports. Test code only. */

export class FakeAuthGateway implements AuthGateway {
  magicLinks: Array<{ email: string; redirectTo: string }> = [];
  /** Codes the callback can exchange, as Supabase would issue after a link or Google sign-in. */
  pendingCodes = new Map<string, { email: string | null; createdAt: Date }>();
  /** Token hashes from email links, as Supabase's admin generateLink returns them. */
  pendingTokenHashes = new Map<string, { email: string | null; createdAt: Date }>();
  accounts = new Map<string, AuthUser>();
  signedIn: AuthUser | null = null;
  lastExchangedId: string | null = null;
  failNextSend = false;
  /** Emails with an account. Links are sent with shouldCreateUser false, so others fail. */
  existingEmails = new Set<string>();
  private seq = 0;

  async sendMagicLink(email: string, redirectTo: string): Promise<void> {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error(`send failed for ${email}`);
    }
    if (!this.existingEmails.has(email)) throw new Error("signups not allowed for otp");
    this.magicLinks.push({ email, redirectTo });
  }

  async googleSignInUrl(redirectTo: string): Promise<string> {
    return `https://auth.example.test/google?redirect_to=${encodeURIComponent(redirectTo)}`;
  }

  async exchangeCode(code: string): Promise<AuthUser | null> {
    const pending = this.pendingCodes.get(code);
    if (!pending) return null;
    this.pendingCodes.delete(code);
    const user: AuthUser = { id: `user-${++this.seq}`, ...pending };
    this.accounts.set(user.id, user);
    this.signedIn = user;
    this.lastExchangedId = user.id;
    return user;
  }

  async verifyEmailToken(tokenHash: string): Promise<AuthUser | null> {
    const pending = this.pendingTokenHashes.get(tokenHash);
    if (!pending) return null;
    this.pendingTokenHashes.delete(tokenHash);
    const user: AuthUser = { id: `user-${++this.seq}`, ...pending };
    this.accounts.set(user.id, user);
    this.signedIn = user;
    this.lastExchangedId = user.id;
    return user;
  }

  async currentUser(): Promise<AuthUser | null> {
    return this.signedIn;
  }

  async signOut(): Promise<void> {
    this.signedIn = null;
  }
}

export class FakeAccountAdmin implements AccountAdmin {
  deleted: string[] = [];
  ensured: string[] = [];
  /** Accounts that accepted the terms, have a Stripe customer or own a product. */
  used = new Set<string>();
  failNextDelete = false;
  failNextEnsure = false;

  constructor(private readonly auth?: FakeAuthGateway) {}

  async ensureUser(email: string): Promise<void> {
    if (this.failNextEnsure) {
      this.failNextEnsure = false;
      throw new Error("create failed");
    }
    if (!this.ensured.includes(email)) this.ensured.push(email);
    this.auth?.existingEmails.add(email);
  }

  async isUnused(userId: string): Promise<boolean> {
    return !this.used.has(userId);
  }

  async deleteUser(userId: string): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("delete failed");
    }
    this.deleted.push(userId);
  }
}

export class FakeTermsStore implements TermsStore {
  acceptedAt = new Map<string, Date>();
  writes = 0;

  async acceptTerms(userId: string): Promise<"accepted" | "already"> {
    if (this.acceptedAt.has(userId)) return "already";
    this.acceptedAt.set(userId, new Date());
    this.writes++;
    return "accepted";
  }
}
