import type { Metadata } from "next";
import Link from "next/link";
import { LegalDraft, Section } from "../_components/legal-draft";

export const metadata: Metadata = { title: "Terms" };

/** Terms of service (docs/PLAN.md 2.4, 12.9), drafted for the solicitor. */
export default function Page() {
  return (
    <LegalDraft title="Terms">
      <p>
        These terms are between you and AskedFor. Our trading name, address and contact email are
        added here before launch.
      </p>
      <Section id="who" title="Who can use AskedFor">
        <p>
          You must be 18 or older. You use AskedFor for your own product or your company&apos;s, and
          you follow our{" "}
          <Link href="/acceptable-use" className="underline">
            acceptable use policy
          </Link>
          .
        </p>
      </Section>
      <Section id="service" title="What we provide">
        <p>
          A daily list of public posts that match your product, with links to the original posts,
          search links you open yourself, and email summaries you can turn off. We never post,
          reply, vote or message for you, and we never write your replies. Which sources are
          collected, and how, is on our{" "}
          <Link href="/sources" className="underline">
            sources page
          </Link>
          .
        </p>
      </Section>
      <Section id="price" title="Price, trial and renewal">
        <p>
          One plan: $29 a month, tax included where it applies. Stripe sells the subscription to you
          as merchant of record and handles tax.
        </p>
        <p>
          You start with a 7-day free trial, and a card is required. We email you at least 48 hours
          before the first charge. When the trial ends your card is charged $29, then $29 every
          month until you cancel.
        </p>
      </Section>
      <Section id="cancel" title="Canceling">
        <p>
          You can cancel online in Settings in two clicks, at any time. You keep access until the
          end of your trial or the month you paid for, and you are not charged again. If a payment
          fails, canceling ends the subscription at once.
        </p>
      </Section>
      <Section id="cooling-off" title="Your right to cancel and refunds">
        <p>
          When you start your trial you ask us to start the service straight away. The wording of
          that request, and your rights to cancel and to a refund, are being reviewed by our
          solicitor and are set out here before we take any payment.
        </p>
      </Section>
      <Section id="ending" title="Ending your account">
        <p>
          You can delete your account in Settings at any time. We may suspend an account that breaks
          the acceptable use policy, and we will tell you why.
        </p>
      </Section>
      <Section id="liability" title="Our responsibility to you">
        <p>
          We work to keep AskedFor running and accurate, but posts come from other people and
          platforms, and we cannot promise any result from replying to them. Nothing in these terms
          limits rights you have by law as a consumer.
        </p>
      </Section>
      <Section id="law" title="Law">
        <p>These terms are governed by the law of England and Wales.</p>
      </Section>
    </LegalDraft>
  );
}
