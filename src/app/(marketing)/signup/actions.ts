"use server";

import { redirect } from "next/navigation";
import { getSignInDeps } from "@/server/auth/deps";
import {
  type CreateAccountResult,
  createAccount,
  resendSignupCode,
  verifySignupCode,
} from "@/server/auth/sign-in";

/** What the create-account form can answer: idle, an email sent, or a reason it was not. */
export type SignupState =
  | { kind: "idle" }
  | Exclude<CreateAccountResult, { kind: "sent" }>
  /** A code was emailed to `email`; the form gives way to the code step. */
  | { kind: "sent"; email: string };

const text = (value: FormDataEntryValue | null): string | null =>
  typeof value === "string" ? value : null;

/**
 * Create an account: email, password and the password again. Supabase emails a six digit code; the
 * code step (codeAction) signs the person in (src/server/auth/sign-in.ts, createAccount). Nothing
 * is logged here but an error class.
 */
export async function signupAction(_prev: SignupState, form: FormData): Promise<SignupState> {
  try {
    const email = text(form.get("email"));
    const result = await createAccount(await getSignInDeps(), {
      email,
      password: form.get("password"),
      confirm: form.get("confirm"),
      next: text(form.get("next")),
    });
    return result.kind === "sent"
      ? { kind: "sent", email: (email ?? "").trim().toLowerCase() }
      : result;
  } catch (error) {
    console.error(
      `[auth] sign up action failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
    return { kind: "error" };
  }
}

/** What the code step can answer. Verifying with the right code redirects, so it never returns. */
export type CodeState =
  | { kind: "idle" }
  | { kind: "wrong" }
  | { kind: "invalid" }
  | { kind: "resent" }
  | { kind: "private_beta" }
  | { kind: "error" };

/**
 * The code step's two buttons share one action, told apart by the submit button's `intent`:
 * "verify" (the default, so Enter in the box verifies) and "resend". The code works from any
 * device, so the email can be read on a phone while the sign-up is on an iPad.
 */
export async function codeAction(_prev: CodeState, form: FormData): Promise<CodeState> {
  const intent = text(form.get("intent")) ?? "verify";
  const email = form.get("email");
  const next = text(form.get("next"));
  let destination: string | null = null;
  try {
    const deps = await getSignInDeps();
    if (intent === "resend") {
      const result = await resendSignupCode(deps, { email, next });
      return result.kind === "sent" ? { kind: "resent" } : result;
    }
    const result = await verifySignupCode(deps, { email, code: form.get("code"), next });
    if (result.kind !== "ok") return result;
    destination = result.path;
  } catch (error) {
    console.error(
      `[auth] code action failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
    return { kind: "error" };
  }
  // redirect() throws, so it stays outside the try.
  redirect(destination);
}
