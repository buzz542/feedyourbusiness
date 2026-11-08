import type { Metadata } from "next";
import Link from "next/link";
import { isLaunchSource, sources } from "@/sources/registry";
import type { CollectSource } from "@/sources/types";
import { DataProviderNotice } from "../_components/data-provider-notice";
import { LegalDraft, Section } from "../_components/legal-draft";
import { PROCESSORS } from "../_components/processors";
import { listInWords } from "../_components/source-list";

export const metadata: Metadata = { title: "Privacy notice" };

/**
 * The privacy notice (docs/PLAN.md 2.3, 12.9), drafted for the solicitor: for people who use
 * AskedFor, and the Article 14 notice for people whose public posts it shows. Processors, sources
 * and vendors come from the code (tests compare the lists).
 */
export default function Page() {
  // The launch sources only: X is out of launch, and the notice says so (8 Nov 2026).
  const collect = sources.filter(
    (s): s is CollectSource => s.mode === "collect" && isLaunchSource(s),
  );
  return (
    <LegalDraft title="Privacy notice">
      <p>
        AskedFor shows makers of software public posts where people ask for a tool like theirs, so
        they can reply in their own words. This notice explains what personal data we handle, why,
        and your rights. AskedFor is the controller. Our trading name, address and contact email are
        added here before launch.
      </p>

      <Section id="authors" title="If you wrote a public post we show">
        <p>
          We collect public posts from {listInWords(collect.map((s) => s.displayName))}. Hacker News
          and Bluesky through their official APIs; Reddit through Bright Data, as set out below. We
          do not collect posts from X.
        </p>
        <p>
          From each post we keep the link, the community, when it was posted, an excerpt of at most
          280 characters, our own labels for it and a keyed hash of the author&apos;s id. We never
          keep usernames, profile pictures, bios or follower counts. Links to Bluesky posts contain
          the author&apos;s DID, a public id that leads to their handle.
        </p>
        <p>
          We keep only posts our classifier rates relevant. Reddit posts are deleted from AskedFor 7
          days after we collect them, and Hacker News and Bluesky posts after 30 days. We drop
          Reddit posts from communities about health, sexuality, religion, politics, ethnicity and
          similar topics, and from user profiles, before they are labeled or stored. We never infer
          anything sensitive about anyone.
        </p>
        <p>
          Why: to show our customers public conversations they can join. Our lawful basis is
          legitimate interests, which we have weighed against yours in a written assessment.
        </p>
        <p>
          You can object, or ask us to delete your posts, with our{" "}
          <Link href="/remove-my-post" className="underline">
            remove my post form
          </Link>
          . We delete what we hold from you on that platform and keep a keyed hash of your id on a
          suppression list, so we never store your posts from it again.
        </p>
      </Section>

      <DataProviderNotice />

      <Section id="users" title="If you use AskedFor">
        <p>
          We keep your email address, your confirmation that you are 18 or older and accept our
          terms, your product profile, search terms and competitors, the posts you save, hide or
          mark replied, your email preferences, and your subscription status. Stripe handles your
          card; we never see it.
        </p>
        <p>
          If you sign in with Google, Supabase keeps your Google account name and picture address in
          its sign-in records. AskedFor never reads them.
        </p>
        <p>
          When you paste your website, our site reader reads that page and up to 5 more on the same
          site, honoring its robots.txt for every page but the one you pasted, and sends the text to
          Anthropic to draft your product profile. We keep the profile, never the pages. If you
          describe your product instead, we send your description.
        </p>
        <p>
          We record a few actions in our own database to see how AskedFor is used, with no cookies,
          IP addresses or browser details, and keep them for 13 months.
        </p>
        <p>
          Why: to provide the service you signed up for (contract), to bill you (contract and legal
          obligation), and to keep the service secure and improve it (legitimate interests).
        </p>
        <p>
          You can download your data or delete your account in Settings at any time. Deleting your
          account cancels your subscription and deletes your data at once. Stripe keeps billing
          records as its role as merchant of record requires.
        </p>
      </Section>

      <Section id="processors" title="Who processes data for us">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          {PROCESSORS.map((p) => (
            <li key={p.name}>
              {p.name}: {p.purpose}. Where: {p.where}. Transfers: {p.transfer}.
            </li>
          ))}
        </ul>
        <p>
          No collected content is used to train any AI model. We use no advertising or third-party
          analytics.
        </p>
      </Section>

      <Section id="rights" title="Your rights">
        <p>
          You can ask for a copy of your data, its correction or deletion, and you can object to our
          use of it or ask us to restrict it. We answer within one month. Removal requests for posts
          are handled within 30 days, and we aim for 72 hours. Requests we have handled are deleted
          12 months later.
        </p>
        <p>
          If you are unhappy with our answer, you can complain to the Information
          Commissioner&apos;s Office (ICO) at ico.org.uk.
        </p>
        <p>
          Cookies: we use only the ones sign-in needs. See our{" "}
          <Link href="/cookies" className="underline">
            cookies page
          </Link>
          .
        </p>
      </Section>
    </LegalDraft>
  );
}
