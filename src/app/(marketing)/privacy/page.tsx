import type { Metadata } from "next";
import Link from "next/link";
import { PROCESSORS } from "@/lib/processors";
import { sources } from "@/sources/registry";
import type { CollectSource } from "@/sources/types";
import { BlueskyLinksNotice } from "../_components/bluesky-links-notice";
import { H2, LegalPlaceholder } from "../_components/legal-placeholder";
import { ContactEmail, tradingDetails } from "../_components/trading-details";
import { VendorNotice } from "../_components/vendor-notice";

export const metadata: Metadata = { title: "Privacy notice" };

const collected = sources.filter((s): s is CollectSource => s.mode === "collect");
const HOW: Readonly<Record<string, string>> = {
  hackernews:
    "through its official API (Hacker News Search by Algolia and the Hacker News item API)",
  bluesky: "through its official API, read-only, from AskedFor's own account",
  reddit: "through Bright Data, a web data company that collects public Reddit pages for us",
  x: "through the official X API, only when it is switched on",
};

/**
 * The privacy notice (docs/PLAN.md 12.9): for customers, and the Article 14 notice for the people
 * whose public posts appear in AskedFor. Names every processor, every collect source and the data
 * provider (tests/compliance/legal.test.ts). Draft for the solicitor.
 */
export default function Page() {
  const trading = tradingDetails();
  return (
    <LegalPlaceholder title="Privacy notice">
      <H2>Who we are</H2>
      <p>
        AskedFor{trading.name ? ` (${trading.name})` : ""} is the controller of the personal data
        described here. Contact us at <ContactEmail />.
      </p>

      <H2>If you have an AskedFor account</H2>
      <p>
        We keep your email address, how you signed in, your product profile (name, web address,
        description, audience, search terms and competitors), your email preferences, and the status
        of your subscription. Stripe holds your card details; we never see them. We use these to run
        the service you signed up for (our contract with you).
      </p>
      <p>
        We record a few events in our own database to understand how AskedFor is used, such as
        opening a tab or marking a post replied. They hold no IP address, no device details and no
        cookies, and are deleted after about a year. We use no third-party analytics, pixels or
        trackers.
      </p>

      <H2>If a post you wrote appears in AskedFor</H2>
      <p>
        AskedFor shows makers public posts where people ask for tools, describe problems or talk
        about products. If you wrote one of those posts, we hold: a link to it, its source and
        community, when it was posted, an excerpt of up to 280 characters, our own labels for it,
        and a keyed hash of your account id. We do not store your username, your profile, your
        picture or your followers.
      </p>
      <p>Where these posts come from:</p>
      <ul className="list-disc pl-5">
        {collected.map((s) => (
          <li key={s.id}>
            {s.displayName}: {HOW[s.id] ?? "through its official API"}. Deleted from AskedFor after{" "}
            {s.retentionDays} days.
          </li>
        ))}
      </ul>
      <p>
        We rely on legitimate interests: helping makers find and reply, in their own words, to
        people who publicly asked for something. We store only posts our classifier rates relevant,
        never infer sensitive traits about anyone, and drop Reddit posts from communities about
        health, sexuality, religion, politics, ethnicity and similar topics before they are
        processed. Posts deleted at the source on Hacker News and Bluesky are deleted here within a
        day; Reddit posts are re-checked once, about 72 hours after collection. Weekly summaries
        keep counts and our own words, never names or quotes.
      </p>
      <p>
        You can object to this or ask us to remove a post at any time with the{" "}
        <Link href="/remove-my-post" className="underline underline-offset-4">
          Remove my post
        </Link>{" "}
        form. We act within 30 days, and we aim for 72 hours. Once removed, your account&apos;s
        posts are not stored again.
      </p>
      <VendorNotice />
      <section aria-labelledby="bluesky-links" className="space-y-3">
        <H2>
          <span id="bluesky-links">Links to Bluesky posts</span>
        </H2>
        <BlueskyLinksNotice />
      </section>

      <H2>Who processes data for us</H2>
      <ul className="list-disc pl-5">
        {PROCESSORS.map((p) => (
          <li key={p.name}>
            {p.name}: {p.purpose} ({p.where}).
          </li>
        ))}
        <li>Bright Data: collecting public Reddit pages, as described above.</li>
      </ul>
      <p>
        Where data leaves the UK, we rely on the UK&apos;s adequacy regulations or the UK
        International Data Transfer Addendum with each processor.
      </p>

      <H2>Cookies</H2>
      <p>
        Only the cookies that keep you signed in. See{" "}
        <Link href="/cookies" className="underline underline-offset-4">
          Cookies
        </Link>
        .
      </p>

      <H2>Your rights</H2>
      <p>
        You can ask for a copy of your data, correction, deletion, restriction, or object to our use
        of it. Account holders can export or delete everything from Settings. If you are not happy
        with how we handle your data, you can complain to the Information Commissioner&apos;s Office
        (ico.org.uk).
      </p>
    </LegalPlaceholder>
  );
}
