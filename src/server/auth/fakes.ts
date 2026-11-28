import {
  type AccountAdmin,
  type AuthGateway,
  type AuthUser,
  SignupsDisabledError,
  type TermsStore,
} from "./ports";

/** In-memory test doubles for the auth ports. Test code only. */

export class FakeAuthGateway implements AuthGateway {
  magicLinks: Array<{ email: string; redirectTo: string }> = [];
  /** Codes the callback can exchange, as Supabase would issue after an email link. */
  pendingCodes = new Map<string, { email: string | null; createdAt: Date }>();
  /** Token hashes from email links, as Supabase's admin generateLink returns them. */
  pendingTokenHashes = new Map<string, { email: string | null; createdAt: Date }>();
  accounts = new Map<string, AuthUser>();
  signedIn: AuthUser | null = null;
  lastExchangedId: string | null = null;
  failNextSend = false;
  failNextSignIn = false;
  /** Passwords by email, as Supabase would hold them (hashed there). */
  passwords = new Map<string, string>();
  resets: Array<{ email: string; redirectTo: string }> = [];
  signUps: Array<{ email: string; password: string; redirectTo: string }> = [];
  /** Supabase's "Allow new users to sign up" switched off (until launch, docs/PLAN.md F5). */
  signUpsDisabled = false;
  /** The verification code last emailed, and the codes outstanding by email. */
  lastCode: string | null = null;
  signupCodes = new Map<string, string>();
  resends: Array<{ email: string; redirectTo: string }> = [];
  private codeSeq = 0;

  private issueCode(email: string): void {
    // Six digits, different every time, like Supabase's token.
    this.lastCode = String(100000 + ++this.codeSeq * 7919).slice(0, 6);
    this.signupCodes.set(email, this.lastCode);
  }
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

  async signUp(email: string, password: string, redirectTo: string): Promise<void> {
    if (this.signUpsDisabled) throw new SignupsDisabledError();
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error(`send failed for ${email} with ${password}`);
    }
    // As Supabase with email confirmation on: an existing account is answered the same, silently.
    if (this.existingEmails.has(email)) return;
    this.signUps.push({ email, password, redirectTo });
    this.issueCode(email);
  }

  async verifySignupCode(email: string, code: string): Promise<AuthUser | null> {
    if (this.failNextSignIn) {
      this.failNextSignIn = false;
      throw new Error(`verify failed for ${email} with ${code}`);
    }
    if (this.signupCodes.get(email) !== code) return null;
    this.signupCodes.delete(email);
    const user: AuthUser = {
      id: `user-${++this.seq}`,
      email,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      canSignInAgain: true,
    };
    this.accounts.set(user.id, user);
    this.signedIn = user;
    return user;
  }

  async resendSignupCode(email: string, redirectTo: string): Promise<void> {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error(`send failed for ${email}`);
    }
    this.resends.push({ email, redirectTo });
    this.issueCode(email);
  }

  async signInWithPassword(email: string, password: string): Promise<AuthUser | null> {
    if (this.failNextSignIn) {
      this.failNextSignIn = false;
      throw new Error(`sign in failed for ${email} with ${password}`);
    }
    if (this.passwords.get(email) !== password) return null;
    const known = [...this.accounts.values()].find((a) => a.email === email);
    const user: AuthUser = known ?? {
      id: `user-${++this.seq}`,
      email,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      canSignInAgain: true,
    };
    this.accounts.set(user.id, user);
    this.signedIn = user;
    return user;
  }

  async setPassword(password: string): Promise<void> {
    if (!this.signedIn?.email) throw new Error("not signed in");
    this.passwords.set(this.signedIn.email, password);
    this.signedIn = { ...this.signedIn, canSignInAgain: true };
    this.accounts.set(this.signedIn.id, this.signedIn);
  }

  async sendPasswordReset(email: string, redirectTo: string): Promise<void> {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error(`send failed for ${email}`);
    }
    this.resets.push({ email, redirectTo });
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
