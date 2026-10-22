"use server";

import { redirect } from "next/navigation";
import { getAuthDeps } from "@/server/auth/deps";
import { safeNextPath } from "@/server/auth/safe-next";
import { requestMagicLink, startGoogleSignIn } from "@/server/auth/sign-in";

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

const loginUrl = (next: string, param: string) =>
  `/login?${param}&next=${encodeURIComponent(safeNextPath(next))}`;

export async function sendMagicLinkAction(form: FormData): Promise<void> {
  const next = field(form, "next");
  const result = await requestMagicLink(getAuthDeps(), { email: field(form, "email"), next });
  redirect(loginUrl(next, result.status === "sent" ? "sent=yes" : `error=${result.status}`));
}

export async function googleSignInAction(form: FormData): Promise<void> {
  const next = field(form, "next");
  const result = await startGoogleSignIn(getAuthDeps(), { next });
  redirect(result.status === "redirect" ? result.url : loginUrl(next, "error=error"));
}
