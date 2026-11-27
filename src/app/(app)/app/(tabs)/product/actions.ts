"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProductFormState } from "@/components/app/product-form";
import { requireAppUser } from "@/server/auth/session";
import { planProfileSave } from "@/server/product/profile";
import { loadProductProfile, saveProductProfile } from "@/server/product/supabase-profile";
import { createSupabaseServerClient } from "@/server/supabase/server";

const PATH = "/app/product";
const FIELDS = [
  "name",
  "url",
  "one_liner",
  "description",
  "audience",
  "relevance_threshold",
  "terms",
] as const;

const logError = (where: string, error: unknown) =>
  console.error(`[product] ${where}: ${error instanceof Error ? error.name : "UnknownError"}`);

/** Saves the product profile (the founder's redesign brief): every field, then the search terms. */
export async function saveProductAction(
  _prev: ProductFormState,
  form: FormData,
): Promise<ProductFormState> {
  const user = await requireAppUser(PATH);
  const values = Object.fromEntries(
    FIELDS.map((k) => [k, typeof form.get(k) === "string" ? String(form.get(k)) : ""]),
  );
  const client = await createSupabaseServerClient();
  let product;
  try {
    product = await loadProductProfile(client, user.id);
  } catch (error) {
    logError("load failed", error);
    return { kind: "error", errors: {}, values };
  }
  // A draft is still being set up: onboarding edits it.
  if (!product || product.status === "draft") redirect("/app/onboarding");
  const plan = planProfileSave(form, product);
  if (!plan.ok) return { kind: "invalid", errors: plan.errors, values };
  try {
    await saveProductProfile(client, product.id, plan);
  } catch (error) {
    logError("save failed", error);
    return { kind: "error", errors: {}, values };
  }
  revalidatePath(PATH);
  revalidatePath("/app/reply");
  return { kind: "saved" };
}
