import "server-only";
import { notFound } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * Admin pages (docs/PLAN.md 4.8) for profiles.is_admin only, which no API role can set. Anyone else
 * gets the ordinary 404, so the pages do not reveal themselves. The proxy checks first; every page
 * and action checks again.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) notFound();
  const db = await createSupabaseServerClient();
  const { data } = await db.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (data?.is_admin !== true) notFound();
  return user;
}
