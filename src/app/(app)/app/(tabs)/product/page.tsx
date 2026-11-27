import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProductForm } from "@/components/app/product-form";
import { requireAppUser } from "@/server/auth/session";
import { loadProductProfile } from "@/server/product/supabase-profile";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { saveProductAction } from "./actions";

export const metadata: Metadata = { title: "Product" };
export const dynamic = "force-dynamic";

/**
 * The product profile after setup (the founder's redesign brief, 27 Nov 2026): review and edit
 * what matching reads. A product still in draft goes to onboarding, which edits drafts. Open to
 * every owner of a confirmed product, entitled or not, like Settings.
 */
export default async function ProductPage() {
  // Layouts do not re-run on client navigation, so each page checks for itself.
  const user = await requireAppUser("/app/product");
  const product = await loadProductProfile(await createSupabaseServerClient(), user.id);
  if (!product || product.status === "draft") redirect("/app/onboarding");
  return (
    <>
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="font-serif text-3xl tracking-tight">Product</h1>
        <p className="text-sm text-muted">What we look for, and how closely a post must match.</p>
      </header>
      <ProductForm
        product={{
          name: product.name,
          url: product.url,
          one_liner: product.one_liner,
          description: product.description,
          audience: product.audience,
          relevance_threshold: product.relevance_threshold,
          terms: product.terms.map((t) => t.term),
        }}
        action={saveProductAction}
      />
    </>
  );
}
