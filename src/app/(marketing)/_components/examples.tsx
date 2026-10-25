import { Highlight } from "@/components/ui/highlight";
import { Tag } from "@/components/ui/tag";
import { CATEGORY_LABELS, DISCLOSURE } from "@/lib/reply-tips";

/**
 * The three tabs with invented example data (docs/PLAN.md 9.6). Every card is labeled "Example",
 * names no real person, product or competitor, and shows no handles, like the product.
 */

const EXCERPT =
  "Is there a simple way to get clients to pay invoices on time? I keep sending reminder emails by hand every Friday.";
const PHRASE = "get clients to pay invoices on time";
const START = EXCERPT.indexOf(PHRASE);

function ExampleLabel() {
  return <Tag className="border-rule-strong text-ink">Example</Tag>;
}

export function ExampleTabs() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <section aria-labelledby="example-reply" className="rounded-[2px] border border-rule p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 id="example-reply" className="font-serif text-lg tracking-tight">
            Reply
          </h3>
          <ExampleLabel />
        </div>
        <p className="mt-1 text-sm text-muted">People worth replying to today.</p>
        <div className="mt-3 rounded-[2px] border border-rule bg-sunk p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-muted">
            <Tag>{CATEGORY_LABELS.pain_point}</Tag>
            <span>Hacker News</span>
          </div>
          <p className="mt-2">
            <Highlight text={EXCERPT} start={START} end={START + PHRASE.length} />
          </p>
          <p className="mt-2 text-muted">Chases late invoices by hand and wants it to stop.</p>
          <p className="mt-2 font-medium">{DISCLOSURE}</p>
        </div>
      </section>

      <section aria-labelledby="example-rivals" className="rounded-[2px] border border-rule p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 id="example-rivals" className="font-serif text-lg tracking-tight">
            Rivals
          </h3>
          <ExampleLabel />
        </div>
        <p className="mt-1 text-sm text-muted">What your competitors get wrong.</p>
        <div className="mt-3 rounded-[2px] border border-rule bg-sunk p-3 text-sm">
          <p className="font-medium">Example rival</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Pricing: the most complaints this week</li>
            <li>Missing exports: up from last week</li>
          </ul>
          <p className="mt-2 text-muted">
            Some people say they want to switch. You see where, and reply in your own words.
          </p>
        </div>
      </section>

      <section aria-labelledby="example-build" className="rounded-[2px] border border-rule p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 id="example-build" className="font-serif text-lg tracking-tight">
            Build
          </h3>
          <ExampleLabel />
        </div>
        <p className="mt-1 text-sm text-muted">What people keep asking for.</p>
        <div className="mt-3 rounded-[2px] border border-rule bg-sunk p-3 text-sm">
          <p className="font-medium">Reminders that do not feel pushy</p>
          <p className="mt-2">
            People want payment reminders that go out on their own but read as if a person wrote
            them.
          </p>
          <p className="mt-2 text-muted">Up from last week. Links to the posts behind it.</p>
        </div>
      </section>
    </div>
  );
}
