import { Highlight } from "@/components/ui/highlight";
import { Tag } from "@/components/ui/tag";
import { ageLabel, CATEGORY_LABELS, DISCLOSURE, REPLY_TIPS, whereLabel } from "@/lib/reply-tips";
import type { FeedCard } from "@/server/reply/feed";

/** The form action that changes a card's state (a server action in the app, a stub in tests). */
export type CardAction = (formData: FormData) => void | Promise<void>;

const STATE_LABELS = { saved: "Saved", replied: "Replied", hidden: "Hidden" } as const;

function ActionButton({
  card,
  to,
  label,
  keyName,
  action,
  back,
}: {
  card: FeedCard;
  to: "new" | "saved" | "replied" | "hidden";
  label: string;
  keyName?: string;
  action: CardAction;
  back: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={card.id} />
      <input type="hidden" name="to" value={to} />
      <input type="hidden" name="back" value={back} />
      {label === "Undo" ? <input type="hidden" name="undo" value="1" /> : null}
      <button
        type="submit"
        data-action={keyName}
        className="inline-flex min-h-10 items-center rounded-[2px] border border-rule-strong px-3 text-sm hover:bg-sunk"
      >
        {label}
      </button>
    </form>
  );
}

/**
 * One Reply card (docs/PLAN.md 4.4): where and when, category, match, the excerpt with the
 * highlighter, why it matched, the rival, and the actions. Open post opens the original in a new
 * tab; the reply tip and "Say you built it." sit next to it. AskedFor never posts for the user.
 */
export function PostCard({
  card,
  now,
  action,
  back,
}: {
  card: FeedCard;
  now: Date;
  action: CardAction;
  back: string;
}) {
  const done = card.state !== "new";
  return (
    <li
      id={`card-${card.id}`}
      data-card
      tabIndex={-1}
      aria-label={`${CATEGORY_LABELS[card.category]}, ${whereLabel(card.source, card.community)}`}
      className="rounded-[2px] border border-rule bg-paper p-4 focus:outline-2 focus:outline-offset-2 focus:outline-accent"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span>{whereLabel(card.source, card.community)}</span>
        <span aria-label={`posted ${ageLabel(card.postedAt, now)} ago`}>
          {ageLabel(card.postedAt, now)}
        </span>
        <Tag>{CATEGORY_LABELS[card.category]}</Tag>
        <span className="tabular-nums">Match {card.relevance}</span>
        {card.rival ? <Tag>Rival: {card.rival.name}</Tag> : null}
        {card.rival?.switching ? <Tag>Looking to switch</Tag> : null}
        {card.state !== "new" ? <Tag>{STATE_LABELS[card.state]}</Tag> : null}
      </div>

      <p className="mt-3 leading-relaxed break-words">
        <Highlight text={card.excerpt} start={card.highlight?.start} end={card.highlight?.end} />
      </p>

      <p className="mt-2 text-sm text-muted">
        <span className="font-medium text-ink">Why it matched: </span>
        {card.reason}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          data-open
          className="inline-flex min-h-10 items-center rounded-[2px] bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          Open post
        </a>
        <span className="text-sm font-medium">{DISCLOSURE}</span>
        <details className="w-full text-sm sm:w-auto">
          <summary className="inline-flex min-h-10 cursor-pointer items-center text-muted underline-offset-4 hover:underline">
            Reply tip
          </summary>
          <p className="mt-1 max-w-prose text-muted">{REPLY_TIPS[card.category]}</p>
        </details>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {card.state === "saved" ? null : (
          <ActionButton
            card={card}
            to="saved"
            label="Save"
            keyName="save"
            action={action}
            back={back}
          />
        )}
        {card.state === "replied" ? null : (
          <ActionButton
            card={card}
            to="replied"
            label="Mark replied"
            keyName="replied"
            action={action}
            back={back}
          />
        )}
        {card.state === "hidden" ? null : (
          <ActionButton
            card={card}
            to="hidden"
            label="Hide"
            keyName="hidden"
            action={action}
            back={back}
          />
        )}
        {done ? (
          <ActionButton card={card} to="new" label="Undo" action={action} back={back} />
        ) : null}
      </div>
    </li>
  );
}
