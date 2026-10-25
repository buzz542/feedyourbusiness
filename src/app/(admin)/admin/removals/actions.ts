"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/admin/require-admin";
import { deleteAndSuppress } from "@/server/privacy/removal";
import { createRemovalAdminDeps } from "@/server/privacy/supabase-removal";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

/** One click: delete matching posts, suppress the author, close, email, audit (docs/PLAN.md 4.8). */
export async function deleteAndSuppressAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return;
  await deleteAndSuppress(
    createRemovalAdminDeps(createSupabaseAdminClient()),
    id,
    admin.id,
    new Date(),
  );
  revalidatePath("/admin/removals");
}
