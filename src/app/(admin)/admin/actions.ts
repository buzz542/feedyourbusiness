"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/admin";
import { closeRemoval, handleRemoval } from "@/server/privacy/removal";
import { loadRemoval, removalDeps } from "@/server/privacy/removal-server";

export type AdminResult = { message: string };

const errorName = (e: unknown) => (e instanceof Error ? e.name : "UnknownError");

/** "Delete and suppress" (docs/PLAN.md 4.8): one click, audited in the same transaction. */
export async function deleteAndSuppress(requestId: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  try {
    const request = await loadRemoval(String(requestId));
    if (!request) return { message: "That request is no longer open." };
    const outcome = await handleRemoval(removalDeps(), request, `admin:${admin.id}`);
    revalidatePath("/admin");
    if (outcome.kind === "removed")
      return { message: `Done: ${outcome.postsDeleted} posts deleted, author suppressed.` };
    if (outcome.kind === "not_found")
      return { message: "Nothing we hold matches. Close it if that is right." };
    return { message: "The link or username cannot be read for that platform. Close it." };
  } catch (error) {
    console.error(`[admin] removal failed: ${errorName(error)}`);
    return { message: `Failed (${errorName(error)}). Nothing changed. Try again.` };
  }
}

/** Close a request we hold nothing for, telling the requester. */
export async function closeWithoutMatch(requestId: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  try {
    const request = await loadRemoval(String(requestId));
    if (!request) return { message: "That request is no longer open." };
    await closeRemoval(removalDeps(), request, `admin:${admin.id}`);
    revalidatePath("/admin");
    return { message: "Closed, and the requester told." };
  } catch (error) {
    console.error(`[admin] close failed: ${errorName(error)}`);
    return { message: `Failed (${errorName(error)}). Nothing changed. Try again.` };
  }
}
