import type { Metadata } from "next";
import { isLaunchOpen } from "@/lib/launch";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { absolute: "FeedYourBusiness: who to reply to today" },
  description:
    "FeedYourBusiness reads public conversations about the problem you solve and shows you the people worth replying to.",
};

const EXAMPLE_EXCERPT_BEFORE = "Does anyone know a tool that ";
const EXAMPLE_EXCERPT_MARK = "chases late invoices for me";
const EXAMPLE_EXCERPT_AFTER = "? I am tired of writing reminder emails every week.";

const FAQ: Array<[string, ReactNode]> = [
  [
    "Does it post for me?",
    "No. FeedYourBusiness never posts, replies, votes or messages for you on any platform. You open the post and reply yourself.",
  ],
  [
    "Does it write replies for me?",
    "No. We give you a short tip for each kind of post, and you write every word.",
  ],
  [
    "Where does Reddit data come from?",
    <>
      From Bright Data, a web data company that collects public Reddit pages for us. This is not a
      data license from Reddit. Our{" "}
      <Link href="/sources" className="text-accent underline underline-offset-2 hover:no-underline">
        sources page
      </Link>{" "}
      has the details.
    </>,
  ],
  [
    "What do you store and for how long?",
    "For each post: the link, the community, when it was posted, a short excerpt, our labels and a keyed hash of the author, never their username. Posts are deleted from FeedYourBusiness after 30 days, or 7 days for Reddit.",
  ],
  [
    "You show a post I wrote. How do I remove it?",
    <>
      Use our{" "}
      <Link
        href="/remove-my-post"
        className="text-accent underline underline-offset-2 hover:no-underline"
      >
        remove my post form
      </Link>
      . We delete your posts and make sure we never store them again.
    </>,
  ],
  [
    "Can I cancel any time?",
    "Yes, in Settings, in two clicks. You keep access until the end of your trial or the month you paid for.",
  ],
];

function Ctas() {
  return (
    <div className="flex flex-wrap gap-3">
      <Link
        href="/login?next=%2Fapp"
        className="inline-flex min-h-11 items-center rounded-[2px] bg-accent-fill px-5 text-base font-medium text-accent-ink hover:opacity-90"
      >
        Start your 3-day trial
      </Link>
      <Link
        href="/pricing"
        className="inline-flex min-h-11 items-center rounded-[2px] border border-control bg-surface px-5 text-base font-medium hover:border-ink"
      >
        See pricing
      </Link>
    </div>
  );
}

function PriceLine() {
  return (
    <p className="text-sm text-muted">
      £39 a month, tax included where it applies, after a{" "}
      <span className="whitespace-nowrap">3-day trial</span> for £1. Cancel in Settings in two
      clicks.
    </p>
  );
}

/**
 * The landing page (docs/PLAN.md 9.6) for Launch 1: the Reply tab is the whole product at launch.
 * Rivals and Build come after launch (founder, 17 Nov 2026), so the page does not mention them.
 * Every sentence is a row in docs/claims.md (the test checks); the example card is labeled,
 * invented, shows no handle and comes from a source collected at launch. No testimonials, counts,
 * badges or competitor names.
 */
export default function Home() {
  return (
    <>
      <section aria-labelledby="hero" className="flex flex-col gap-6 pt-4 sm:pt-10">
        <h1
          id="hero"
          className="font-serif text-5xl leading-[1.05] tracking-tight text-balance sm:text-6xl"
        >
          Who to reply to today.
        </h1>
        <p className="max-w-[38rem] text-lg leading-relaxed text-muted sm:text-xl">
          FeedYourBusiness reads public conversations about the problem you solve, then shows you
          the people worth replying to. You reply in your own words, and say you built it.
        </p>
        <Ctas />
        <div className="flex flex-col gap-1">
          <PriceLine />
          {isLaunchOpen() ? null : (
            <p className="text-sm text-muted">
              FeedYourBusiness is in private beta. Until launch, sign-in is by invitation.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="example" className="mt-20 flex flex-col gap-5">
        <h2 id="example" className="font-serif text-3xl tracking-tight">
          What a day looks like
        </h2>
        <figure aria-label="Example post card" className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            Example, invented
          </p>
          <article className="flex flex-col gap-3 rounded-[2px] border border-rule bg-surface p-5">
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">Hacker News</span>
              {" · "}
              Looking for a tool
              {" · "}A strong match
            </p>
            <p className="text-[15px] leading-relaxed">
              {EXAMPLE_EXCERPT_BEFORE}
              <mark>{EXAMPLE_EXCERPT_MARK}</mark>
              {EXAMPLE_EXCERPT_AFTER}
            </p>
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">Why it matched:</span> asks for a tool that
              sends invoice reminders.
            </p>
            <p className="border-t border-rule pt-3 text-sm font-medium">
              Open the post, reply in your own words, and say you built it.
            </p>
            {/* A copy of the Reply card's buttons for the eye only: the example cannot be clicked. */}
            <div aria-hidden="true" className="flex flex-wrap gap-2">
              <span className="inline-flex min-h-9 items-center rounded-[2px] border px-3 text-sm font-medium border-transparent bg-accent-fill text-accent-ink">
                Open post
              </span>
              <span className="inline-flex min-h-9 items-center rounded-[2px] border px-3 text-sm font-medium border-control">
                Save
              </span>
              <span className="inline-flex min-h-9 items-center rounded-[2px] border px-3 text-sm font-medium border-control">
                Hide
              </span>
              <span className="inline-flex min-h-9 items-center rounded-[2px] border px-3 text-sm font-medium border-control">
                I replied
              </span>
            </div>
          </article>
        </figure>
      </section>

      <section aria-labelledby="how" className="mt-20 flex flex-col gap-5">
        <h2 id="how" className="font-serif text-3xl tracking-tight">
          How it works
        </h2>
        <ol className="grid list-none gap-4 [counter-reset:step] sm:grid-cols-3">
          {[
            "Paste your website. We read it and draft your search terms and competitors.",
            "Each day we collect public posts that match and keep the ones worth your time.",
            "You open each post and reply in your own words.",
          ].map((step) => (
            <li
              key={step}
              className="flex flex-col gap-3 rounded-[2px] border border-rule bg-surface p-5 leading-relaxed [counter-increment:step] before:font-serif before:text-3xl before:leading-none before:text-accent before:content-[counter(step)]"
            >
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="sources" className="mt-20 flex flex-col gap-5">
        <h2 id="sources" className="font-serif text-3xl tracking-tight">
          Where your posts come from
        </h2>
        <ul className="flex flex-col divide-y divide-rule rounded-[2px] border border-rule bg-surface">
          {[
            "Hacker News and Bluesky through their official APIs.",
            "Reddit through a web data company that collects public Reddit pages for us, named on our sources page.",
            "X is coming later.",
            "LinkedIn, Facebook and Threads as one-tap searches you open yourself.",
          ].map((line) => (
            <li key={line} className="px-5 py-3.5 leading-relaxed">
              {line}
            </li>
          ))}
        </ul>
        <p className="leading-relaxed">
          We never post, reply or message for you, and we never write your replies. Posts are
          deleted from FeedYourBusiness after 30 days, or 7 days for Reddit.
        </p>
        <p>
          <Link
            href="/sources"
            className="text-accent underline underline-offset-2 hover:no-underline"
          >
            Every source, and how we use it
          </Link>
        </p>
      </section>

      <section aria-labelledby="faq" className="mt-20 flex flex-col gap-5">
        <h2 id="faq" className="font-serif text-3xl tracking-tight">
          Questions
        </h2>
        <div className="flex flex-col divide-y divide-rule border-y border-rule">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-1">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  aria-hidden="true"
                  className="text-xl leading-none text-muted transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <div className="pb-4 leading-relaxed text-muted">
                <p>{a}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="start"
        className="mt-20 flex flex-col gap-5 rounded-[2px] border border-rule bg-panel p-6 sm:p-8"
      >
        <h2 id="start" className="font-serif text-3xl tracking-tight">
          Who to reply to today.
        </h2>
        <PriceLine />
        <Ctas />
      </section>
    </>
  );
}
