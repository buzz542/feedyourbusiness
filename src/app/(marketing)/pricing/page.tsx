import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing",
  description: "One plan for AskedFor, with a free trial and two-click cancellation.",
};

/**
 * Pricing (docs/PLAN.md 2.4, D7): one plan, the full price up front with tax included where it
 * applies, the trial, the reminder and how to cancel. Every claim is a row in docs/claims.md.
 */
export default function PricingPage() {
  return (
    <article className="space-y-8">
      <div>
        <h1 className="font-serif text-4xl tracking-tight">Pricing</h1>
        <p className="mt-4 text-lg">One plan, with everything in it.</p>
      </div>

      <section aria-labelledby="plan" className="rounded-[2px] border border-rule p-6">
        <h2 id="plan" className="font-serif text-3xl tracking-tight">
          $29 a month
        </h2>
        <p className="mt-2 text-muted">
          Where sales tax or VAT applies, it is included in this price.
        </p>
        <ul className="mt-5 space-y-2">
          <li>Start with a 7-day free trial. A card is required to start it.</li>
          <li>We email you at least 48 hours before your first charge.</li>
          <li>
            After the trial, your card is charged $29 each month until you cancel. Cancel any time
            in Settings, in two clicks.
          </li>
          <li>Payments are handled by Stripe.</li>
        </ul>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex min-h-10 items-center rounded-[2px] bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            Start your free trial
          </Link>
        </div>
      </section>

      <section aria-labelledby="included">
        <h2 id="included" className="font-serif text-2xl tracking-tight">
          What you get
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Reply: public posts worth replying to, every morning, with why each one matched.</li>
          <li>Rivals: what your competitors get wrong, and who wants to switch.</li>
          <li>Build: the patterns in what people ask for, and what to build next.</li>
          <li>
            A daily email when there are new posts, and a Monday digest. Both can be turned off.
          </li>
          <li>
            Search links for the platforms AskedFor does not collect, to open yourself. See{" "}
            <Link href="/sources" className="underline underline-offset-4">
              where posts come from
            </Link>
            .
          </li>
        </ul>
        <p className="mt-4 text-muted">
          AskedFor never posts, replies or messages for you, and never writes your replies.
        </p>
      </section>
    </article>
  );
}
