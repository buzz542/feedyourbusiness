"use server";

import { redirect } from "next/navigation";
import { createSupabaseAuthGateway } from "@/server/auth/supabase-auth";

/** Sign out. Server actions carry Next's origin check (docs/PLAN.md 12.2). */
export async function signOutAction(): Promise<void> {
  try {
    await (await createSupabaseAuthGateway()).signOut();
  } catch (error) {
    console.error(
      `[auth] sign out failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
  }
  redirect("/");
}
