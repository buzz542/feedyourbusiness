"use server";

import { redirect } from "next/navigation";
import { getSignInDeps } from "@/server/auth/deps";
import { type MagicLinkResult, requestMagicLink, startGoogleSignIn } from "@/server/auth/sign-in";

export type LinkState = { kind: "idle" } | MagicLinkResult;

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

export async function googleAction(form: FormData): Promise<void> {
  let url: string | null = null;
  try {
    const result = await startGoogleSignIn(await getSignInDeps(), { next: text(form.get("next")) });
    if (result.kind === "redirect") url = result.url;
  } catch (error) {
    logFailure("google action", error);
  }
  // redirect() throws, so it stays outside the try.
  redirect(url ?? "/login?error=google");
}
