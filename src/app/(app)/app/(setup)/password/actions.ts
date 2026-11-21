"use server";

import { redirect } from "next/navigation";
import { requireAppUser } from "@/server/auth/session";
import { setNewPassword, type SetPasswordResult } from "@/server/auth/sign-in";
import { createSupabaseAuthGateway } from "@/server/auth/supabase-auth";

export type PasswordState = { kind: "idle" } | Exclude<SetPasswordResult, { kind: "set" }>;

/** Set the signed-in user's password. The password is read from the form and never logged or returned. */
export async function setPasswordAction(
  _prev: PasswordState,
  form: FormData,
): Promise<PasswordState> {
  const user = await requireAppUser("/app/password");
  const result = await setNewPassword(await createSupabaseAuthGateway(), user, {
    password: form.get("password"),
    confirm: form.get("confirm"),
  });
  if (result.kind !== "set") return result;
  // redirect() throws, so it stays outside any try.
  redirect("/app");
}
