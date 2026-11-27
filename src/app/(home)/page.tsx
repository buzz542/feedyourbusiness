import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/ui/brand";
import { isLaunchOpen } from "@/lib/launch";
import { CtaLink, ExampleViewed } from "@/app/(marketing)/_components/tracked";

const DESCRIPTION =
  "FeedYourBusiness finds public conversations about the problem your product solves. See why each one matches, then reply in your own words.";

export const metadata: Metadata = {
  title: { absolute: "FeedYourBusiness: find people already asking for what you built" },
  description: DESCRIPTION,
};

const EXAMPLE_BEFORE = "Does anyone know a tool that ";
const EXAMPLE_MARK = "chases late invoices for me";
const EXAMPLE_AFTER = "? I am tired of writing reminder emails every week.";
const EXAMPLE_WHY = "They are asking for a tool that sends invoice reminders.";

const FAQ: Array<[string, ReactNode]> = [
  [
    "What does FeedYourBusiness do?",
    "It finds public conversations about the problem your product solves and explains why each one matches. You decide which ones to answer.",
  ],
  [
    "Does it send replies for me?",
    "No. You open the original conversation and reply in your own words. Be helpful and disclose that you built the product.",
  ],
  [
    "Which platforms does it support?",
    <>
      Hacker News, Bluesky and Reddit, collected for you each day. LinkedIn, Facebook and Threads as
      one-tap searches you open yourself. Our{" "}
      <Link href="/sources" className="underline underline-offset-2 hover:no-underline">
        sources page
      </Link>{" "}
      has the details.
    </>,
  ],
  [
    "How does the trial work?",
    "Start with a 3-day trial for £1, charged today. A card is required to start it. When the trial ends, your card is charged £39, then £39 every month until you cancel.",
  ],
  [
    "How do I cancel?",
    "In Settings, in two clicks. You keep access until the end of your trial or the month you paid for.",
  ],
  [
    "Will every conversation be a perfect match?",
    "No. Read the context and decide whether your product is relevant. You can hide anything that is not a fit.",
  ],
  [
    "Where does Reddit data come from?",
    <>
      From Bright Data, a web data company that collects public Reddit pages for us. This is not a
      data license from Reddit. Our{" "}
      <Link href="/sources" className="underline underline-offset-2 hover:no-underline">
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
      <Link href="/remove-my-post" className="underline underline-offset-2 hover:no-underline">
        remove my post form
      </Link>
      . We delete your posts and make sure we never store them again.
    </>,
  ],
];

/** One primary action everywhere (the brief): start the trial when sign-up is open, else sign in. */
function PrimaryCta({ placement }: { placement: "hero" | "pricing" | "final" }) {
  return (
    <CtaLink
      placement={placement}
      href="/login?next=%2Fapp"
      className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent-fill px-6 text-base font-medium text-accent-ink hover:opacity-90"
    >
      {isLaunchOpen() ? "Start your trial" : "Sign in with your invitation"}
    </CtaLink>
  );
}

function Terms() {
  return (
    <div className="flex flex-col gap-1 text-sm text-muted">
      <p>
        £39 a month, tax included where it applies, after a{" "}
        <span className="whitespace-nowrap">3-day trial</span> for £1. Cancel in Settings in two
        clicks.
      </p>
      {isLaunchOpen() ? null : (
        <p>FeedYourBusiness is in private beta. Until launch, sign-in is by invitation.</p>
      )}
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-28 text-3xl tracking-tight text-balance sm:text-4xl">
      {children}
    </h2>
  );
}

/** The dark app, as an example: a compact sidebar, Today and one conversation (the brief). */
function AppPreview() {
  return (
    <figure aria-label="Example post card" className="flex flex-col gap-3">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">
        Example, invented, for a product that sends invoice reminders
      </p>
      <div className="theme-dark overflow-hidden rounded-3xl border border-rule bg-panel p-2 text-ink shadow-2xl shadow-black/10 sm:p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
          <div className="hidden flex-col gap-1 p-3 text-sm sm:flex" aria-hidden="true">
            <span className="mb-3 inline-flex items-center gap-2 font-semibold">
              <BrandMark className="h-5 w-5" />
              Your product
            </span>
            <span className="rounded-lg bg-selected px-2.5 py-1.5 text-ink">Today</span>
            <span className="px-2.5 py-1.5 text-muted">Saved</span>
            <span className="px-2.5 py-1.5 text-muted">Replied</span>
            <span className="px-2.5 py-1.5 text-muted">Hidden</span>
          </div>
          <div className="flex flex-col gap-4 rounded-2xl bg-paper p-4 sm:p-6">
            <p className="text-xl font-semibold tracking-tight" aria-hidden="true">
              Today
            </p>
            <article className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5">
              <p className="text-sm text-muted">
                <span className="font-medium text-ink">Reddit</span>
                {" · "}r/freelance
              </p>
              <p className="text-[15px] leading-relaxed">
                {EXAMPLE_BEFORE}
                <mark>{EXAMPLE_MARK}</mark>
                {EXAMPLE_AFTER}
              </p>
              <div className="rounded-xl bg-selected p-3.5 text-sm">
                <p className="font-medium">Why it matched</p>
                <p className="mt-1 text-muted">{EXAMPLE_WHY}</p>
              </div>
              <p className="text-sm font-medium">Say you built it.</p>
              {/* The Reply card's actions for the eye only: the example cannot be clicked. */}
              <div aria-hidden="true" className="flex flex-wrap gap-2">
                <span className="inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium bg-accent-fill text-accent-ink">
                  View conversation
                </span>
                <span className="inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium border border-control">
                  Save
                </span>
                <span className="inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium border border-control">
                  Hide
                </span>
              </div>
            </article>
          </div>
        </div>
      </div>
      <p className="text-sm text-muted">You decide whether you can help. You write every reply.</p>
    </figure>
  );
}

/**
 * The homepage (the founder's redesign brief, 27 Nov 2026; docs/PLAN.md 9.6). One primary action,
 * the product shown early, the full price beside every call to action, and every sentence a row in
 * docs/claims.md (the test checks). The example is labeled, invented and shows no handle. No
 * testimonials, counts, badges or competitor names.
 */
export default function Home() {
  return (
    <div className="flex flex-col gap-28 pb-8">
      <section
        aria-labelledby="hero"
        className="grid items-center gap-12 pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:pt-16"
      >
        <div className="flex flex-col gap-6">
          <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
            For founders doing their own marketing
          </p>
          <h1 id="hero" className="text-5xl leading-[1.04] tracking-tight text-balance sm:text-6xl">
            Find people already asking for what you built.
          </h1>
          <p className="max-w-[34rem] text-lg leading-relaxed text-muted">{DESCRIPTION}</p>
          <div className="flex flex-wrap gap-3">
            <PrimaryCta placement="hero" />
            <a
              href="#example"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-control bg-surface px-6 text-base font-medium hover:border-ink"
            >
              See an example
            </a>
          </div>
          <Terms />
        </div>
        <ExampleViewed id="example" className="scroll-mt-28">
          <AppPreview />
        </ExampleViewed>
      </section>

      <section aria-labelledby="how" className="flex scroll-mt-28 flex-col gap-10">
        <SectionHeading id="how">Less searching. More useful conversations.</SectionHeading>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            [
              "Describe your product",
              "Tell FeedYourBusiness what you built and the problem it solves.",
            ],
            ["Review relevant conversations", "Read the original question and see why it matches."],
            ["Reply as yourself", "Open the conversation, be helpful, and say you built it."],
          ].map(([title, body]) => (
            <article key={title} className="flex flex-col gap-3 rounded-3xl bg-panel p-7">
              <h3 className="text-xl tracking-tight">{title}</h3>
              <p className="leading-relaxed text-muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="value" className="grid gap-10 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
          <SectionHeading id="value">A reason to reply. Not another feed to scroll.</SectionHeading>
          <p className="text-lg leading-relaxed text-muted">
            See the question and the reason it matched, so you can decide whether your product is
            genuinely relevant.
          </p>
          <ul className="flex flex-col gap-3">
            {[
              "Read the original context.",
              "Understand the match.",
              "Choose whether to reply.",
            ].map((line) => (
              <li key={line} className="flex items-center gap-3 font-medium">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <figure
          aria-label="Example match, explained"
          className="flex flex-col gap-3 rounded-3xl border border-rule p-6 sm:p-8"
        >
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            Example, invented
          </p>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold">The conversation</p>
            <p className="rounded-2xl bg-panel p-4 leading-relaxed">
              {EXAMPLE_BEFORE}
              {EXAMPLE_MARK}
              {EXAMPLE_AFTER}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold">Why it matched</p>
            <p className="leading-relaxed text-muted">{EXAMPLE_WHY}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold">What you do</p>
            <p className="leading-relaxed text-muted">
              Open the conversation, be helpful, and say you built it.
            </p>
          </div>
        </figure>
      </section>

      <section aria-labelledby="sources" className="flex flex-col gap-8">
        <SectionHeading id="sources">Where conversations come from</SectionHeading>
        <ul className="grid gap-3 md:grid-cols-2">
          {[
            "Hacker News and Bluesky through their official APIs.",
            "Reddit through a web data company that collects public Reddit pages for us, named on our sources page.",
            "X is coming later.",
            "LinkedIn, Facebook and Threads as one-tap searches you open yourself.",
          ].map((line) => (
            <li key={line} className="rounded-2xl border border-rule px-5 py-4 leading-relaxed">
              {line}
            </li>
          ))}
        </ul>
        <p className="max-w-3xl leading-relaxed text-muted">
          We never post, reply or message for you, and we never write your replies. Posts are
          deleted from FeedYourBusiness after 30 days, or 7 days for Reddit.
        </p>
        <p>
          <Link href="/sources" className="font-medium underline underline-offset-4">
            Every source, and how we use it
          </Link>
        </p>
      </section>

      <section aria-labelledby="pricing" className="flex flex-col gap-10">
        <SectionHeading id="pricing">Clear pricing. No surprises.</SectionHeading>
        <div className="grid max-w-3xl gap-6 rounded-3xl border border-rule p-7 sm:p-10">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-5xl font-semibold tracking-tight">£39</span>
            <span className="text-muted">a month</span>
          </div>
          <ul className="flex flex-col gap-3 leading-relaxed">
            <li>Start with a 3-day trial for £1, charged today. A card is required to start it.</li>
            <li>
              When the trial ends, your card is charged £39, then £39 every month until you cancel.
            </li>
            <li>We email you at least 48 hours before the first £39 charge.</li>
            <li>Cancel in Settings in two clicks.</li>
            <li>£39 a month, tax included where it applies. Prices in pounds sterling.</li>
          </ul>
          <div>
            <PrimaryCta placement="pricing" />
          </div>
        </div>
      </section>

      <section aria-labelledby="faq" className="flex flex-col gap-8">
        <SectionHeading id="faq">Questions</SectionHeading>
        <div className="flex max-w-3xl flex-col divide-y divide-rule border-y border-rule">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-1">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  aria-hidden="true"
                  className="text-xl leading-none text-muted transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <div className="pb-5 leading-relaxed text-muted">
                <p>{a}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="start"
        className="flex flex-col items-start gap-6 rounded-3xl bg-panel p-8 sm:p-12"
      >
        <SectionHeading id="start">Find your next useful conversation.</SectionHeading>
        <p className="text-lg text-muted">
          See where people are discussing the problem your product solves.
        </p>
        <PrimaryCta placement="final" />
        <Terms />
      </section>
    </div>
  );
}
