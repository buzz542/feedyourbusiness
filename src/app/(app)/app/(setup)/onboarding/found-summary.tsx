import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { OnboardingView } from "@/server/onboarding/wiring";

/** The terms shown before "and N more" (docs/PLAN.md 4.3 step 4). */
export const TERMS_SHOWN = 8;

/** "Here's what we found", in plain words: what it does and for whom, rivals, terms, communities. */
export function FoundSummary({
  view,
}: {
  view: Pick<OnboardingView, "product" | "terms" | "competitors">;
}) {
  const { product, terms, competitors } = view;
  const rest = terms.length - TERMS_SHOWN;
  return (
    <Card className="space-y-6 p-5">
      <section>
        <h2 className="font-serif text-2xl tracking-tight">{product.name}</h2>
        {product.one_liner ? <p className="mt-2">{product.one_liner}</p> : null}
        {product.audience ? (
          <p className="mt-2 text-muted">
            <span className="font-medium text-ink">For: </span>
            {product.audience}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="found-rivals">
        <h3 id="found-rivals" className="text-sm font-medium">
          Competitors
        </h3>
        {competitors.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None yet. You can add them below.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {competitors.map((c) => (
              <li key={c.id}>
                <Chip>
                  {c.name}
                  {c.aliases.length > 0 ? (
                    <span className="ml-1 text-muted">(also {c.aliases.join(", ")})</span>
                  ) : null}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="found-terms">
        <h3 id="found-terms" className="text-sm font-medium">
          What we will search for
        </h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {terms.slice(0, TERMS_SHOWN).map((t) => (
            <li key={t.id}>
              <Chip>{t.term}</Chip>
            </li>
          ))}
        </ul>
        {rest > 0 ? (
          <p className="mt-2 text-sm text-muted">
            and {rest} more {rest === 1 ? "term" : "terms"}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="found-communities">
        <h3 id="found-communities" className="text-sm font-medium">
          Communities
        </h3>
        {product.subreddits.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None suggested.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {product.subreddits.map((s) => (
              <li key={s}>
                <Chip>r/{s}</Chip>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
