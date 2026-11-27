"use server";

import { redirect } from "next/navigation";
import { getSignInDeps } from "@/server/auth/deps";
import {
  type MagicLinkResult,
  requestMagicLink,
  requestPasswordReset,
  signInWithPassword,
} from "@/server/auth/sign-in";

export type LinkState = { kind: "idle" } | MagicLinkResult;

/** What the one login form can answer: a sent reset or a refusal. */
export type LoginState =
  | { kind: "idle" }
  | { kind: "reset_sent" }
  | { kind: "wrong" }
  | { kind: "private_beta" }
  | { kind: "invalid" }
  | { kind: "error" };

const text = (value: FormDataEntryValue | null): string | null =>
  typeof value === "string" ? value : null;

const logFailure = (step: string, error: unknown) =>
  console.error(`[auth] ${step} failed: ${error instanceof Error ? error.name : "UnknownError"}`);

export async function sendLinkAction(_prev: LinkState, form: FormData): Promise<LinkState> {
  try {
    return await requestMagicLink(await getSignInDeps(), {
      email: form.get("email"),
      next: text(form.get("next")),
    });
  } catch (error) {
    logFailure("magic link action", error);
    return { kind: "error" };
  }
}

/**
 * The login form's two buttons share one action, told apart by the submit button's `intent`:
 * "password" (the default, so Enter in a field signs in) and "reset". A password sign-in that
 * works redirects, so it never returns.
 */
export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const intent = text(form.get("intent")) ?? "password";
  const email = form.get("email");
  const next = text(form.get("next"));
  let destination: string | null = null;
  try {
    const deps = await getSignInDeps();
    if (intent === "reset") {
      const result = await requestPasswordReset(deps, { email });
      return result.kind === "sent" ? { kind: "reset_sent" } : result;
    }
    const result = await signInWithPassword(deps, {
      email,
      password: form.get("password"),
      next,
    });
    if (result.kind !== "ok") return result;
    destination = result.path;
  } catch (error) {
    logFailure("login action", error);
    return { kind: "error" };
  }
  // redirect() throws, so it stays outside the try.
  redirect(destination);
}
