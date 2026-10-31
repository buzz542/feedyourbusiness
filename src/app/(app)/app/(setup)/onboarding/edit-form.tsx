"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { EditField } from "@/server/onboarding/review";
import type { OnboardingView } from "@/server/onboarding/wiring";
import { saveAndConfirmAction, type EditState } from "./actions";

const field = "w-full rounded-[2px] border border-rule bg-paper p-2";

/** "Change something": every field, folded away; one button saves and confirms (4.3 step 4). */
export function EditForm({ view }: { view: OnboardingView }) {
  const [state, save, pending] = useActionState<EditState, FormData>(saveAndConfirmAction, {
    kind: "idle",
  });
  const error = (name: EditField) =>
    state.kind === "invalid" && state.errors[name] ? (
      <p id={`${name}-error`} role="alert" className="text-sm text-negative">
        {state.errors[name]}
      </p>
    ) : null;
  const described = (name: EditField) =>
    state.kind === "invalid" && state.errors[name] ? `${name}-error` : undefined;
  const invalid = (name: EditField) =>
    state.kind === "invalid" && state.errors[name] ? true : undefined;
  /** What the user typed last, or what is saved: a refused save never wipes an edit. */
  const typed = (
    name: keyof NonNullable<Extract<EditState, { values: unknown }>["values"]>,
    saved: string,
  ) => (state.kind === "idle" ? saved : (state.values[name] ?? saved));
  const { product } = view;

  return (
    <form action={save} className="mt-4 space-y-4">
      {(
        [
          ["name", "Name", product.name, 1],
          ["one_liner", "One-line summary", product.one_liner ?? "", 2],
          ["description", "What it does", product.description ?? "", 4],
          ["audience", "Who it's for", product.audience ?? "", 3],
        ] as const
      ).map(([name, label, value, rows]) => (
        <div key={name}>
          <label htmlFor={`edit-${name}`} className="block text-sm font-medium">
            {label}
          </label>
          <textarea
            id={`edit-${name}`}
            name={name}
            rows={rows}
            defaultValue={typed(name, value)}
            aria-describedby={described(name)}
            aria-invalid={invalid(name)}
            className={field}
          />
          {error(name)}
        </div>
      ))}
      <div>
        <label htmlFor="edit-terms" className="block text-sm font-medium">
          Search terms, one a line (up to 40)
        </label>
        <textarea
          id="edit-terms"
          name="terms"
          rows={8}
          defaultValue={typed("terms", view.terms.map((t) => t.term).join("\n"))}
          aria-describedby={described("terms")}
          aria-invalid={invalid("terms")}
          className={field}
        />
        {error("terms")}
      </div>
      <div>
        <label htmlFor="edit-competitors" className="block text-sm font-medium">
          Competitors, one a line: name, then a comma and the domain if you like (up to 20)
        </label>
        <textarea
          id="edit-competitors"
          name="competitors"
          rows={4}
          defaultValue={typed(
            "competitors",
            view.competitors.map((c) => (c.domain ? `${c.name}, ${c.domain}` : c.name)).join("\n"),
          )}
          aria-describedby={described("competitors")}
          aria-invalid={invalid("competitors")}
          className={field}
        />
        {error("competitors")}
      </div>
      <div>
        <label htmlFor="edit-subreddits" className="block text-sm font-medium">
          Communities, separated by commas (up to 10)
        </label>
        <input
          id="edit-subreddits"
          name="subreddits"
          defaultValue={typed("subreddits", product.subreddits.join(", "))}
          aria-describedby={described("subreddits")}
          aria-invalid={invalid("subreddits")}
          className={field}
        />
        {error("subreddits")}
      </div>
      <div>
        <label htmlFor="edit-threshold" className="block text-sm font-medium">
          Show posts that match at least (40 to 95)
        </label>
        <input
          id="edit-threshold"
          name="relevance_threshold"
          type="number"
          min={40}
          max={95}
          defaultValue={typed("relevance_threshold", String(product.relevance_threshold))}
          aria-describedby={described("relevance_threshold")}
          aria-invalid={invalid("relevance_threshold")}
          className={`${field} max-w-24`}
        />
        {error("relevance_threshold")}
      </div>
      <Button type="submit" disabled={pending}>
        Save and confirm
      </Button>
      <p role="status" aria-live="polite" className="min-h-6 text-sm">
        {state.kind === "error"
          ? "Something went wrong, and nothing was saved. Try again."
          : state.kind === "invalid"
            ? "Nothing was saved yet. Check the fields marked below."
            : ""}
      </p>
    </form>
  );
}
