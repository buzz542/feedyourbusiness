"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ProfileField } from "@/server/product/profile";

export interface ProductFormView {
  name: string;
  url: string | null;
  one_liner: string | null;
  description: string | null;
  audience: string | null;
  relevance_threshold: number;
  terms: readonly string[];
}

type FieldName =
  "name" | "url" | "one_liner" | "description" | "audience" | "relevance_threshold" | "terms";

export type ProductFormState =
  | { kind: "idle" }
  | { kind: "saved" }
  | {
      kind: "invalid" | "error";
      errors: Partial<Record<ProfileField, string>>;
      /** What the user typed, so a refused save never wipes it (React resets the form). */
      values: Partial<Record<FieldName, string>>;
    };

const field = "w-full rounded-xl border border-control bg-paper p-2";

/**
 * The product profile after setup (the founder's redesign brief, 27 Nov 2026): what matching reads,
 * each field labeled, and what it changes said without promising results. The page passes the save
 * action.
 */
export function ProductForm({
  product,
  action,
}: {
  product: ProductFormView;
  action: (state: ProductFormState, form: FormData) => Promise<ProductFormState>;
}) {
  const [state, save, pending] = useActionState<ProductFormState, FormData>(action, {
    kind: "idle",
  });
  const failed = state.kind === "invalid" || state.kind === "error" ? state : null;
  const errorOf = (name: ProfileField) =>
    failed?.kind === "invalid" ? failed.errors[name] : undefined;
  const error = (name: ProfileField) =>
    errorOf(name) ? (
      <p id={`${name}-error`} role="alert" className="mt-1 text-sm text-negative">
        {errorOf(name)}
      </p>
    ) : null;
  const aria = (name: ProfileField) =>
    errorOf(name) ? { "aria-describedby": `${name}-error`, "aria-invalid": true } : {};
  /** What the user typed last, or what is saved: a refused save never wipes an edit. */
  const typed = (name: FieldName, saved: string) => failed?.values[name] ?? saved;

  return (
    <div className="flex flex-col gap-8">
      <section
        aria-labelledby="matching-heading"
        className="rounded-xl border border-rule bg-surface p-4 text-sm sm:p-5"
      >
        <h2 id="matching-heading" className="font-serif text-lg tracking-tight">
          How this shapes your feed
        </h2>
        <p className="mt-2 text-muted">
          We search public posts for your search terms. A model then reads each post next to your
          description and audience and rates how closely it matches; posts at or above your minimum
          match appear in your feed. Naming the problem you solve, in the words your customers use,
          helps it tell a real need from a passing mention.
        </p>
        <p className="mt-2 text-muted">
          Matches are a starting point. Read each conversation and decide whether you can help. New
          search terms apply from the next collection; the minimum match applies at once.
        </p>
      </section>

      <form action={save} className="flex flex-col gap-5">
        <div>
          <label htmlFor="product-name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="product-name"
            name="name"
            defaultValue={typed("name", product.name)}
            className={field}
            {...aria("name")}
          />
          {error("name")}
        </div>
        <div>
          <label htmlFor="product-url" className="block text-sm font-medium">
            Website
          </label>
          <input
            id="product-url"
            name="url"
            type="url"
            inputMode="url"
            defaultValue={typed("url", product.url ?? "")}
            className={field}
            {...aria("url")}
          />
          {error("url")}
        </div>
        {(
          [
            ["one_liner", "One-line summary", product.one_liner ?? "", 2],
            ["description", "What it does and the problem it solves", product.description ?? "", 5],
            ["audience", "Who it's for", product.audience ?? "", 3],
          ] as const
        ).map(([name, label, value, rows]) => (
          <div key={name}>
            <label htmlFor={`product-${name}`} className="block text-sm font-medium">
              {label}
            </label>
            <textarea
              id={`product-${name}`}
              name={name}
              rows={rows}
              defaultValue={typed(name, value)}
              className={field}
              {...aria(name)}
            />
            {error(name)}
          </div>
        ))}
        <div>
          <label htmlFor="product-terms" className="block text-sm font-medium">
            Search terms, one a line
          </label>
          <p id="terms-hint" className="text-sm text-muted">
            Up to 40. At most 3 that are only a competitor&apos;s name, and 4 &quot;alternative
            to&quot; phrases. Phrases people write when they need you tend to find more than brand
            names.
          </p>
          <textarea
            id="product-terms"
            name="terms"
            rows={10}
            defaultValue={typed("terms", product.terms.join("\n"))}
            className={field}
            {...aria("terms")}
            aria-describedby={errorOf("terms") ? "terms-hint terms-error" : "terms-hint"}
          />
          {error("terms")}
        </div>
        <div>
          <label htmlFor="product-threshold" className="block text-sm font-medium">
            Minimum match
          </label>
          <p id="threshold-hint" className="text-sm text-muted">
            From 40 to 95. Lower shows more conversations, including weaker matches.
          </p>
          <input
            id="product-threshold"
            name="relevance_threshold"
            type="number"
            min={40}
            max={95}
            defaultValue={typed("relevance_threshold", String(product.relevance_threshold))}
            className={`${field} max-w-24`}
            {...aria("relevance_threshold")}
            aria-describedby={
              errorOf("relevance_threshold")
                ? "threshold-hint relevance_threshold-error"
                : "threshold-hint"
            }
          />
          {error("relevance_threshold")}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving" : "Save changes"}
          </Button>
          <p role="status" aria-live="polite" className="min-h-6 text-sm">
            {state.kind === "saved"
              ? "Saved."
              : state.kind === "error"
                ? "Something went wrong, and nothing was saved. Try again."
                : state.kind === "invalid"
                  ? "Nothing was saved yet. Check the fields marked below."
                  : ""}
          </p>
        </div>
      </form>
    </div>
  );
}
