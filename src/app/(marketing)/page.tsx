import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: { absolute: "AskedFor: who to reply to today" },
  description:
    "AskedFor reads public conversations about the problem you solve and shows you the people worth replying to.",
};

const EXAMPLE_EXCERPT_BEFORE = "Does anyone know a tool that ";
const EXAMPLE_EXCERPT_MARK = "chases late invoices for me";
const EXAMPLE_EXCERPT_AFTER = "? I am tired of writing reminder emails every week.";

const FAQ: Array<[string, string]> = [
  [
    "Does it post for me?",
    "No. AskedFor never posts, replies, votes or messages for you on any platform. You open the post and reply yourself.",
  ],
  [
    "Does it write replies for me?",
    "No. We give you a short tip for each kind of post, and you write every word.",
  ],
  [
    "Where does Reddit data come from?",
    "From Bright Data, a web data company that collects public Reddit pages for us. This is not a data license from Reddit. Our sources page has the details.",
  ],
  [
    "What do you store and for how long?",
    "For each post: the link, the community, when it was posted, a short excerpt, our labels and a keyed hash of the author, never their username. Posts are deleted from AskedFor after 30 days, or 7 days for Reddit and X.",
  ],
  [
    "You show a post I wrote. How do I remove it?",
    "Use our remove my post form. We delete your posts and make sure we never store them again.",
  ],
  [
    "Can I cancel any time?",
    "Yes, in Settings, in two clicks. You keep access until the end of your trial or the month you paid for.",
  ],
];

/**
 * The landing page (docs/PLAN.md 9.6) for Launch 1: the Reply tab is live; Rivals and Build are
 * described as coming next, never shown with example data as if they were live. Every sentence is
 * a row in docs/claims.md (the test checks); the example card is labeled, invented, and shows no
 * handle. No testimonials, counts, badges or competitor names.
 */
export default function Home() {
  return (
    <>
      <section aria-labelledby="hero" className="space-y-6">
        <h1 id="hero" className="font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
          Who to reply to today.
        </h1>
        <p className="max-w-prose text-lg text-muted">
          AskedFor reads public conversations about the problem you solve, then shows you the people
          worth replying to. You reply in your own words, and say you built it.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/login?next=%2Fapp"
            className="rounded-[2px] bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            Start your free trial
          </Link>
          <Link
            href="/pricing"
            className="rounded-[2px] border border-rule px-3 py-1.5 text-sm font-medium hover:border-ink"
          >
            See pricing
          </Link>
        </div>
        <p className="text-sm text-muted">
          $29 a month, tax included where it applies, after a 7-day free trial. Cancel in Settings
          in two clicks.
        </p>
        <p className="text-sm text-muted">
          AskedFor is in private beta. Until launch, sign-in is by invitation.
        </p>
      </section>

      <section aria-labelledby="example" className="mt-14 space-y-4">
        <h2 id="example" className="font-serif text-2xl tracking-tight">
          What a day looks like
        </h2>
        <article className="rounded-[2px] border border-rule p-4" aria-label="Example post card">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Example, invented
          </p>
          <p className="mt-2 text-sm text-muted">
            Reddit · r/freelance · Looking for a tool · A strong match
          </p>
          <p className="mt-2">
            {EXAMPLE_EXCERPT_BEFORE}
            <mark className="bg-highlight text-ink">{EXAMPLE_EXCERPT_MARK}</mark>
            {EXAMPLE_EXCERPT_AFTER}
          </p>
          <p className="mt-2 text-sm">
            Why it matched: asks for a tool that sends invoice reminders.
          </p>
          <p className="mt-2 text-sm text-muted">
            Open the post, reply in your own words, and say you built it.
          </p>
        </article>
      </section>

      <section aria-labelledby="how" className="mt-14 space-y-4">
        <h2 id="how" className="font-serif text-2xl tracking-tight">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          <li className="rounded-[2px] border border-rule p-4">
            Paste your website. We read it and draft your search terms and competitors.
          </li>
          <li className="rounded-[2px] border border-rule p-4">
            Each day we collect public posts that match and keep the ones worth your time.
          </li>
          <li className="rounded-[2px] border border-rule p-4">
            You open each post and reply in your own words.
          </li>
        </ol>
      </section>

      <section aria-labelledby="sources" className="mt-14 space-y-3">
        <h2 id="sources" className="font-serif text-2xl tracking-tight">
          Where your posts come from
        </h2>
        <p>
          Hacker News and Bluesky through their official APIs. Reddit through a web data company
          that collects public Reddit pages for us, named on our sources page. X through its
          official API when it is switched on. LinkedIn, Facebook and Threads as one-tap searches
          you open yourself.
        </p>
        <p>
          We never post, reply or message for you, and we never write your replies. Posts are
          deleted from AskedFor after 30 days, or 7 days for Reddit and X.
        </p>
        <p>
          <Link href="/sources" className="underline">
            Every source, and how we use it
          </Link>
        </p>
      </section>

      <section aria-labelledby="next" className="mt-14 space-y-3">
        <h2 id="next" className="font-serif text-2xl tracking-tight">
          Coming next
        </h2>
        <p>
          Rivals: what your competitors get wrong, and who wants to switch. Build: the patterns in
          what people ask for, and what to build next. Both are on the way and come with the same
          plan.
        </p>
      </section>

      <section aria-labelledby="faq" className="mt-14 space-y-4">
        <h2 id="faq" className="font-serif text-2xl tracking-tight">
          Questions
        </h2>
        <dl className="space-y-4">
          {FAQ.map(([q, a]) => (
            <div key={q}>
              <dt className="font-medium">{q}</dt>
              <dd className="mt-1 text-muted">
                <p>{a}</p>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
