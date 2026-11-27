"use server";

import { getSignInDeps } from "@/server/auth/deps";
import { type CreateAccountResult, createAccount } from "@/server/auth/sign-in";

/** What the create-account form can answer: idle, an email sent, or a reason it was not. */
export type SignupState =
  { kind: "idle" } | Exclude<CreateAccountResult, { kind: "sent" }> | { kind: "sent" };

const text = (value: FormDataEntryValue | null): string | null =>
  typeof value === "string" ? value : null;

/**
 * Create an account: email, password and the password again. Supabase emails a verification link;
 * the account signs in once it is opened (src/server/auth/sign-in.ts, createAccount). Nothing is
 * logged here but an error class.
 */
export async function signupAction(_prev: SignupState, form: FormData): Promise<SignupState> {
  try {
    return await createAccount(await getSignInDeps(), {
      email: form.get("email"),
      password: form.get("password"),
      confirm: form.get("confirm"),
      next: text(form.get("next")),
    });
  } catch (error) {
    console.error(
      `[auth] sign up action failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
    return { kind: "error" };
  }
}
