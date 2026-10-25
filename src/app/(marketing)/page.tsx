import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ExampleTabs } from "./_components/examples";
import { InstantPreview } from "./_components/instant-preview";
import { previewAction } from "./preview-action";

export const metadata: Metadata = {
  description:
    "Who to reply to today. What your rivals get wrong. What to build next. A daily list of public posts about the problem you solve.",
};

/**
 * The landing page (docs/PLAN.md 9.6). Every claim and number is a row in docs/claims.md. No
 * testimonials, user counts, badges or competitor names.
 */
export default function Home() {
  return (
    <div className="space-y-16">
      <section aria-labelledby="hero" className="space-y-6">
        <h1 id="hero" className="font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
          Who to reply to today. What your rivals get wrong. What to build next.
        </h1>
        <p className="max-w-prose text-lg text-muted">
          AskedFor reads public conversations about the problem you solve, then shows you the people
          worth replying to, where your rivals fall short, and what people keep asking for.
        </p>
        <InstantPreview action={previewAction} />
        <div className="flex flex-wrap items-center gap-3">
          <Button href="/login" variant="secondary">
            Start 7-day trial
          </Button>
          <p className="text-sm text-muted">
            $29 a month, tax included where it applies. Card required for the trial. Renews monthly
            until you cancel.
          </p>
        </div>
      </section>

      <section aria-labelledby="tabs" className="space-y-4">
        <h2 id="tabs" className="font-serif text-2xl tracking-tight">
          Three tabs, every morning
        </h2>
        <ExampleTabs />
      </section>

      <section aria-labelledby="how" className="space-y-4">
        <h2 id="how" className="font-serif text-2xl tracking-tight">
          How it works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          <li className="rounded-[2px] border border-rule p-4">
            Paste your product&apos;s URL. We draft your search terms and you check them.
          </li>
          <li className="rounded-[2px] border border-rule p-4">
            We collect public posts that match and keep only the ones that fit your product.
          </li>
          <li className="rounded-[2px] border border-rule p-4">
            You reply in your own words, and see what your rivals miss.
          </li>
        </ol>
      </section>

      <section
        aria-labelledby="where"
        className="space-y-3 rounded-[2px] border border-rule-strong p-6"
      >
        <h2 id="where" className="font-serif text-2xl tracking-tight">
          Where your posts come from
        </h2>
        <p>
          Hacker News and Bluesky through their official APIs. Reddit through a web data company
          that collects public Reddit pages for us (named on our sources page). X through its
          official API when it is switched on. LinkedIn, Facebook and Threads as one-tap searches
          you open yourself. We never post, reply or message for you, and we never write your
          replies. Raw posts are deleted from AskedFor after 30 days, or 7 days for Reddit and X.
        </p>
        <p>
          <Link href="/sources" className="underline underline-offset-4">
            See every source and how it is reached
          </Link>
        </p>
      </section>

      <section aria-labelledby="pricing" className="space-y-3">
        <h2 id="pricing" className="font-serif text-2xl tracking-tight">
          Pricing
        </h2>
        <p className="font-serif text-3xl tracking-tight">$29 a month</p>
        <ul className="space-y-1">
          <li>Where sales tax or VAT applies, it is included in this price.</li>
          <li>Start with a 7-day free trial. A card is required to start it.</li>
          <li>We email you at least 48 hours before your first charge.</li>
          <li>Cancel any time in Settings, in two clicks.</li>
        </ul>
        <p>
          <Link href="/pricing" className="underline underline-offset-4">
            Pricing details
          </Link>
        </p>
      </section>

      <section aria-labelledby="faq" className="space-y-4">
        <h2 id="faq" className="font-serif text-2xl tracking-tight">
          Questions
        </h2>
        <dl className="space-y-5">
          <div>
            <dt className="font-medium">Does it post for me?</dt>
            <dd className="mt-1 text-muted">
              No. AskedFor never posts, replies, votes or messages on any platform. You open each
              post and reply yourself.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Does it write replies for me?</dt>
            <dd className="mt-1 text-muted">
              No. You write every word. Each post comes with a short, fixed tip for its kind of post
              and a reminder to say you built it.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Where does Reddit data come from?</dt>
            <dd className="mt-1 text-muted">
              From Bright Data, a web data company that collects public Reddit pages for us, logged
              out. This is not a data license from Reddit. The{" "}
              <Link href="/sources" className="underline underline-offset-4">
                sources page
              </Link>{" "}
              has the details.
            </dd>
          </div>
          <div>
            <dt className="font-medium">What do you store, and for how long?</dt>
            <dd className="mt-1 text-muted">
              For each matching post: its link, where and when it was posted, an excerpt of up to
              280 characters, our labels and a keyed hash of the author, never their name or handle.
              Posts are deleted after 30 days, or 7 days for Reddit and X. The{" "}
              <Link href="/privacy" className="underline underline-offset-4">
                privacy notice
              </Link>{" "}
              has the rest.
            </dd>
          </div>
          <div>
            <dt className="font-medium">You show a post I wrote. How do I remove it?</dt>
            <dd className="mt-1 text-muted">
              Use the{" "}
              <Link href="/remove-my-post" className="underline underline-offset-4">
                Remove my post
              </Link>{" "}
              form. We delete your posts and stop collecting them. We act within 30 days, and we aim
              for 72 hours.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Can I cancel any time?</dt>
            <dd className="mt-1 text-muted">
              Yes. Cancel any time in Settings, in two clicks. You keep access until the end of the
              period you have paid for.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
