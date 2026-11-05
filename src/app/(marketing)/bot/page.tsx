import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, CONTACT_EMAIL_LIVE } from "@/lib/contact";
import { OWN_SITE_USER_AGENT } from "@/server/net/own-site";

export const metadata: Metadata = {
  title: "Our site reader",
  description: "What the AskedFor site reader fetches, why, and how to stop it.",
};

/**
 * /bot (docs/PLAN.md 12.3): what the site reader fetches and why, its robots token, and a
 * monitored contact. The reader's User-Agent links here. Every paragraph and list item is a row in
 * docs/claims.md (the test checks).
 */
export default function BotPage({ contactLive = CONTACT_EMAIL_LIVE }: { contactLive?: boolean }) {
  return (
    <article className="space-y-6">
      <h1 className="font-serif text-3xl tracking-tight">Our site reader</h1>
      <p>
        When someone sets up AskedFor, they paste the address of their own product&apos;s website.
        Our site reader reads that page, or the home page if the pasted page is about people, and up
        to 5 more pages on the same site that say what the product does, such as pricing, features
        or questions and answers. We use the text to draft a short profile of the product. We keep
        the profile, never the pages.
      </p>
      <section aria-labelledby="what" className="space-y-3">
        <h2 id="what" className="font-serif text-2xl tracking-tight">
          What it reads
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            At most 7 requests each time it reads a site, robots.txt included, one at a time, and at
            most 3 redirects for each, all on the same site.
          </li>
          <li>Only the site that was pasted, never a link to another site.</li>
          <li>
            Never pages whose address names people, such as team, customer, blog, careers or contact
            pages, and never sign-in or legal pages.
          </li>
          <li>
            Never known social networks, forums, app stores, code hosts, review sites or profile
            pages.
          </li>
        </ul>
      </section>
      <section aria-labelledby="robots" className="space-y-3">
        <h2 id="robots" className="font-serif text-2xl tracking-tight">
          How to stop it
        </h2>
        <p>
          The page the person pasted is read because they asked for it, and so is your home page
          when the pasted page is about people. Every other page follows your robots.txt: the group
          for the token AskedFor if you have one, or else the group for every robot. To keep those
          pages off limits, add:
        </p>
        <pre className="overflow-x-auto rounded-[2px] border border-rule p-3 text-sm">
          {"User-agent: AskedFor\nDisallow: /"}
        </pre>
        <p>It identifies itself with this User-Agent:</p>
        <pre className="overflow-x-auto rounded-[2px] border border-rule p-3 text-sm">
          {OWN_SITE_USER_AGENT}
        </pre>
      </section>
      <section aria-labelledby="contact" className="space-y-3">
        <h2 id="contact" className="font-serif text-2xl tracking-tight">
          Contact
        </h2>
        {contactLive ? (
          <p>
            Questions or problems with the site reader:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        ) : (
          <p>A contact address for the site reader is added here before launch.</p>
        )}
        <p>
          Where the posts AskedFor shows come from is on our{" "}
          <Link href="/sources" className="underline">
            sources page
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
