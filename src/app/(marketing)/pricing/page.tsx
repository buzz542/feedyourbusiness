import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing",
  description: "One plan, $29 a month, tax included where it applies, with a 7-day free trial.",
};

/**
 * Public pricing (docs/PLAN.md 2.4, 9.6 item 5, D7): one plan, the full price with tax included
 * where it applies, the trial, the card, the reminder and how to cancel, all before checkout.
 * Every sentence with a number is a row in docs/claims.md; the price is ADVERTISED_PRICE, which
 * /api/health compares with Stripe's.
 */
export default function PricingPage() {
  return (
    <>
      <h1 className="font-serif text-4xl leading-tight tracking-tight">Pricing</h1>
      <section
        aria-labelledby="plan-heading"
        className="mt-8 flex flex-col gap-4 rounded-[2px] border border-rule p-6"
      >
        <h2 id="plan-heading" className="font-serif text-2xl tracking-tight">
          One plan
        </h2>
        <p>
          <span className="text-3xl">$29 a month</span>
          <span className="text-muted">, tax included where it applies. Prices in US dollars.</span>
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>Start with a 7-day free trial. A card is required to start it.</li>
          <li>We email you at least 48 hours before the first charge.</li>
          <li>
            When the trial ends, your card is charged $29, then $29 every month until you cancel.
          </li>
          <li>
            Cancel online in Settings in two clicks. You keep access until the end of your trial or
            the month you paid for.
          </li>
          <li>No other plans and no add-ons.</li>
        </ul>
        <Link
          href="/login?next=%2Fapp"
          className="self-start rounded-[2px] bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          Start your free trial
        </Link>
      </section>

      <section aria-labelledby="included-heading" className="mt-10 flex flex-col gap-3">
        <h2 id="included-heading" className="font-serif text-2xl tracking-tight">
          What you get
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            Every morning, public posts where someone asks for a tool like yours or describes the
            problem you solve, each with a link to the post so you can reply yourself.
          </li>
          <li>One-tap searches on the platforms we do not collect from, opened in your browser.</li>
          <li>An email when there are new posts, which you can turn off in one click.</li>
          <li>We never post or reply for you, and we never write your replies.</li>
        </ul>
        <p className="text-muted">
          Where posts come from is on{" "}
          <Link href="/sources" className="underline">
            our sources page
          </Link>
          . The full subscription terms are in our{" "}
          <Link href="/terms" className="underline">
            terms
          </Link>
          .
        </p>
      </section>
    </>
  );
}
