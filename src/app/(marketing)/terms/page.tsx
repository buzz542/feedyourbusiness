import type { Metadata } from "next";
import Link from "next/link";
import { H2, LegalPlaceholder } from "../_components/legal-placeholder";

export const metadata: Metadata = { title: "Terms" };

/** Terms of service (docs/PLAN.md 12.9). Draft for the solicitor. */
export default function Page() {
  return (
    <LegalPlaceholder title="Terms">
      <H2>The service</H2>
      <p>
        AskedFor shows you public posts that match your product, what people say about your
        competitors, and patterns in what people ask for. It never posts, replies, votes or messages
        on any platform for you, and it never writes your replies.
      </p>
      <H2>Who can use it</H2>
      <p>AskedFor is for people 18 and over, using it for their own business.</p>
      <H2>Your subscription</H2>
      <p>
        One plan, at the price shown on the{" "}
        <Link href="/pricing" className="underline underline-offset-4">
          pricing page
        </Link>{" "}
        and before checkout. The trial is free; a card is required to start it. We email you before
        the first charge. When the trial ends your card is charged, and then again each month until
        you cancel.
      </p>
      <H2>Canceling</H2>
      <p>
        Cancel any time in Settings, in two clicks. You keep access until the end of the period you
        paid for, and you are not charged again.
      </p>
      <H2>Your right to cancel and refunds</H2>
      <p>
        If you are a consumer in the UK, you can cancel within your cancellation period. When you
        start, you ask us to begin the service straight away; if you cancel after the free trial has
        turned into a paid subscription but within that period, you may be charged for the service
        you used. Otherwise payments are not refunded for a part month.
      </p>
      <H2>Acceptable use</H2>
      <p>
        You agree to the{" "}
        <Link href="/acceptable-use" className="underline underline-offset-4">
          Acceptable use policy
        </Link>
        . We may suspend accounts that break it.
      </p>
      <H2>Liability</H2>
      <p>
        We provide AskedFor with reasonable care and skill. We do not promise any number of posts,
        replies or customers. Nothing here limits rights you have by law.
      </p>
    </LegalPlaceholder>
  );
}
