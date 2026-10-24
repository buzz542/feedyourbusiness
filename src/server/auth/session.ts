import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { loadAllowlist } from "./allowlist";
import { gateUser, loginPathFor } from "./gate";
import type { AuthUser } from "./ports";
import { PRIVATE_BETA_PATH } from "./sign-in";
import { createSupabaseAuthGateway } from "./supabase-auth";

export const TERMS_PATH = "/app/terms";

class TermsLookupError extends Error {
  override name = "TermsLookupError";
  constructor(readonly code: string | undefined) {
    super("Could not read terms acceptance");
  }
}

/**
 * For app pages and server actions: the signed-in, allowed user who has accepted the terms, or a
 * redirect. `path` is where to return after sign-in. Only the terms step itself passes
 * `{ beforeTerms: true }`, so no deep link skips the 18+ confirmation (docs/PLAN.md 4.3).
 */
export async function requireAppUser(
  path: string,
  options: { beforeTerms?: boolean } = {},
): Promise<AuthUser> {
  const auth = await createSupabaseAuthGateway();
  const gate = gateUser(await auth.currentUser(), loadAllowlist());
  if (gate.kind === "anonymous") redirect(loginPathFor(path));
  if (gate.kind === "refused") {
    try {
      await auth.signOut();
    } catch (error) {
      console.error(
        `[auth] sign out failed: ${error instanceof Error ? error.name : "UnknownError"}`,
      );
    }
    redirect(PRIVATE_BETA_PATH);
  }
  if (!options.beforeTerms && !(await hasAcceptedTerms(gate.user.id))) redirect(TERMS_PATH);
  return gate.user;
}

export async function hasAcceptedTerms(userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("terms_accepted_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new TermsLookupError(error.code);
  return data?.terms_accepted_at != null;
}
