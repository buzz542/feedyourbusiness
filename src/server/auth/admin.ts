import "server-only";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { createSupabaseAuthGateway } from "./supabase-auth";

/**
 * Admin pages and actions (docs/PLAN.md 4.8): the signed-in user whose own profile says is_admin,
 * which only the founder can set in SQL. Everyone else gets a 404, as the proxy already answers.
 */
export async function requireAdmin(): Promise<{ id: string }> {
  const user = await (await createSupabaseAuthGateway()).currentUser();
  if (!user) notFound();
  const { data, error } = await (
    await createSupabaseServerClient()
  )
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (error || data?.is_admin !== true) notFound();
  return { id: user.id };
}
