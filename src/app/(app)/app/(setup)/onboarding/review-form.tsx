"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ReviewProduct, TermIntent } from "@/server/onboarding/ports";
import { reviewAction, type ReviewState } from "./actions";

type Product = Omit<ReviewProduct, "id" | "status">;
type CompetitorRow = { key: number; name: string; domain: string; aliases: string };

const INTENT_LABELS: Record<TermIntent, string> = {
  problem: "Problem",
  category: "Category",
  alternative: "Alternative",
  competitor: "Competitor",
};

const FIELD_LABELS: Record<string, string> = {
  url: "Product URL",
  name: "Name",
  one_liner: "One-line summary",
  description: "Description",
  audience: "Who it is for",
  relevance_threshold: "Minimum match",
  terms: "Search terms",
  competitors: "Competitors",
  subreddits: "Subreddits",
};

const inputClass = "w-full rounded-[2px] border border-rule bg-paper px-3 py-2";

function message(state: ReviewState): string {
  switch (state.kind) {
    case "idle":
      return "";
    case "saved":
      return state.leftOut.length === 0
        ? "Saved."
        : `Saved. We left out ${state.leftOut.map((s) => `r/${s}`).join(", ")}: AskedFor never uses communities about health, politics, religion, sexuality, ethnicity or similar topics.`;
    case "invalid":
      return `Check ${state.fields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}.`;
    case "needs_terms":
      return "Add at least one search term to confirm.";
    case "already_confirmed":
      return "Your product is already set up. You can change it in Settings.";
    case "no_product":
      return "Start with your product's web address.";
    case "failed":
      return "Something went wrong. Try again.";
  }
}

let nextKey = 0;
const toRow = (c: Product["competitors"][number]): CompetitorRow => ({
  key: nextKey++,
  name: c.name,
  domain: c.domain ?? "",
  aliases: c.aliases.join(", "),
});

export function ReviewForm({
  product,
  limits,
}: {
  product: Product;
  /** From the server's own limits (src/server/onboarding/review.ts), which it enforces. */
  limits: { terms: number; competitors: number };
}) {
  const [state, submit, pending] = useActionState<ReviewState, FormData>(reviewAction, {
    kind: "idle",
  });
  const [terms, setTerms] = useState(product.terms);
  const [newTerm, setNewTerm] = useState("");
  const [competitors, setCompetitors] = useState(() => product.competitors.map(toRow));
  const [subreddits, setSubreddits] = useState(product.subreddits.join(", "));

  const addTerm = () => {
    const term = newTerm.trim();
    if (!term || terms.length >= limits.terms) return;
    setTerms([...terms, { term, intent: "problem" }]);
    setNewTerm("");
  };

  const competitorJson = JSON.stringify(
    competitors
      .filter((c) => c.name.trim())
      .map((c) => ({
        name: c.name,
        domain: c.domain,
        aliases: c.aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
      })),
  );
  const subredditJson = JSON.stringify(
    subreddits
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  return (
    <form action={submit} className="mt-8 space-y-8">
      <input type="hidden" name="terms" value={JSON.stringify(terms)} />
      <input type="hidden" name="competitors" value={competitorJson} />
      <input type="hidden" name="subreddits" value={subredditJson} />

      <section className="space-y-4">
        <h2 className="font-serif text-xl tracking-tight">Your product</h2>
        <Field id="name" label="Name">
          <input
            id="name"
            name="name"
            defaultValue={product.name}
            required
            maxLength={120}
            className={inputClass}
          />
        </Field>
        <Field id="url" label="Product URL">
          <input id="url" name="url" defaultValue={product.url} required className={inputClass} />
        </Field>
        <Field id="one_liner" label="One-line summary">
          <input
            id="one_liner"
            name="one_liner"
            defaultValue={product.oneLiner}
            maxLength={160}
            className={inputClass}
          />
        </Field>
        <Field id="description" label="Description">
          <textarea
            id="description"
            name="description"
            defaultValue={product.description}
            maxLength={2000}
            rows={5}
            className={inputClass}
          />
        </Field>
        <Field id="audience" label="Who it is for">
          <textarea
            id="audience"
            name="audience"
            defaultValue={product.audience}
            maxLength={1000}
            rows={3}
            className={inputClass}
          />
        </Field>
        <Field
          id="relevance_threshold"
          label="Minimum match (40 to 95)"
          hint="Posts that match less well than this are not shown."
        >
          <input
            id="relevance_threshold"
            name="relevance_threshold"
            type="number"
            min={40}
            max={95}
            step={1}
            defaultValue={product.relevanceThreshold}
            required
            className={`${inputClass} max-w-32 tabular-nums`}
          />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl tracking-tight">Search terms</h2>
        <p className="text-sm text-muted">
          Phrases people write when they need what you make. Up to {limits.terms}.
        </p>
        <ul className="space-y-2">
          {terms.map((t, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-2 border-b border-rule pb-2 sm:border-0 sm:pb-0"
            >
              <input
                aria-label={`Search term ${i + 1}`}
                value={t.term}
                maxLength={60}
                onChange={(e) =>
                  setTerms(terms.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)))
                }
                className={`${inputClass} min-w-0 basis-full sm:basis-0 sm:flex-1`}
              />
              <select
                aria-label={`Kind of term ${i + 1}`}
                value={t.intent}
                onChange={(e) =>
                  setTerms(
                    terms.map((x, j) =>
                      j === i ? { ...x, intent: e.target.value as TermIntent } : x,
                    ),
                  )
                }
                className="rounded-[2px] border border-rule bg-paper px-2 py-2 text-sm"
              >
                {Object.entries(INTENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                aria-label={`Remove ${t.term || `term ${i + 1}`}`}
                onClick={() => setTerms(terms.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="New search term"
            value={newTerm}
            maxLength={60}
            placeholder="how do I ..."
            onChange={(e) => setNewTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTerm();
              }
            }}
            className={`${inputClass} min-w-0 flex-1`}
          />
          <Button variant="secondary" onClick={addTerm} disabled={terms.length >= limits.terms}>
            Add term
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl tracking-tight">Competitors</h2>
        <p className="text-sm text-muted">
          Products people compare yours with. Domain and other names are optional.
        </p>
        <ul className="space-y-3">
          {competitors.map((c, i) => (
            <li
              key={c.key}
              className="grid gap-2 border-b border-rule pb-3 sm:grid-cols-[2fr_2fr_3fr_auto] sm:border-0 sm:pb-0"
            >
              <input
                aria-label={`Competitor ${i + 1} name`}
                value={c.name}
                maxLength={80}
                placeholder="Name"
                onChange={(e) =>
                  setCompetitors(
                    competitors.map((x) => (x.key === c.key ? { ...x, name: e.target.value } : x)),
                  )
                }
                className={inputClass}
              />
              <input
                aria-label={`Competitor ${i + 1} domain`}
                value={c.domain}
                placeholder="example.com"
                onChange={(e) =>
                  setCompetitors(
                    competitors.map((x) =>
                      x.key === c.key ? { ...x, domain: e.target.value } : x,
                    ),
                  )
                }
                className={inputClass}
              />
              <input
                aria-label={`Competitor ${i + 1} other names`}
                value={c.aliases}
                placeholder="Other names, comma separated"
                onChange={(e) =>
                  setCompetitors(
                    competitors.map((x) =>
                      x.key === c.key ? { ...x, aliases: e.target.value } : x,
                    ),
                  )
                }
                className={inputClass}
              />
              <Button
                variant="secondary"
                aria-label={`Remove ${c.name || `competitor ${i + 1}`}`}
                onClick={() => setCompetitors(competitors.filter((x) => x.key !== c.key))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <Button
          variant="secondary"
          disabled={competitors.length >= limits.competitors}
          onClick={() =>
            setCompetitors([...competitors, { key: nextKey++, name: "", domain: "", aliases: "" }])
          }
        >
          Add competitor
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl tracking-tight">Subreddits</h2>
        <Field
          id="subreddit_list"
          label="Subreddits for your search links, comma separated"
          hint="Up to 10. AskedFor never uses communities about health, politics, religion, sexuality, ethnicity or similar topics."
        >
          <input
            id="subreddit_list"
            value={subreddits}
            onChange={(e) => setSubreddits(e.target.value)}
            className={inputClass}
          />
        </Field>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-6">
        <Button type="submit" name="intent" value="confirm" disabled={pending}>
          Confirm and continue
        </Button>
        <Button type="submit" name="intent" value="save" variant="secondary" disabled={pending}>
          Save changes
        </Button>
        <a
          href="/app/onboarding?step=url"
          className="text-sm text-muted underline underline-offset-4"
        >
          Draft again from a web address
        </a>
      </div>
      <p role="status" aria-live="polite" className="min-h-6 text-sm">
        {pending ? "Saving..." : message(state)}
      </p>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}
