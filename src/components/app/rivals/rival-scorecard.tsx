import { Sparkline } from "@/components/ui/sparkline";
import { TREND_ARROWS, TREND_LABELS, type Scorecard } from "@/server/rivals/view";

/**
 * One rival this week (docs/PLAN.md 4.5): complaints, people looking to switch, top issues with a
 * trend arrow and words (never color alone), the last 8 weeks as a sparkline, and our own summary.
 * No names or quotes of the people who posted.
 */
export function RivalScorecard({ card }: { card: Scorecard }) {
  const maxIssue = Math.max(1, ...card.issues.map((i) => i.complaints));
  return (
    <article
      className="rounded-[2px] border border-rule bg-paper p-4"
      aria-labelledby={`rival-${card.key}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`rival-${card.key}`} className="font-serif text-lg tracking-tight">
          {card.name}
        </h3>
        <Sparkline
          values={card.history}
          label={`Complaints over the last 9 weeks, oldest first: ${card.history.join(", ")}`}
        />
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div>
          <dt className="inline text-muted">Complaints this week: </dt>
          <dd className="inline tabular-nums font-medium">{card.complaints}</dd>
        </div>
        <div>
          <dt className="inline text-muted">Looking to switch: </dt>
          <dd className="inline tabular-nums font-medium">{card.switching}</dd>
        </div>
      </dl>
      {card.issues.length > 0 ? (
        <ul className="mt-3 space-y-1.5" aria-label="Where they fall short">
          {card.issues.map((issue) => (
            <li
              key={issue.issue}
              className="grid grid-cols-[8rem_1fr_auto] items-center gap-2 text-sm"
            >
              <span>{issue.label}</span>
              <span aria-hidden="true" className="h-2 rounded-[1px] bg-sunk">
                <span
                  className="block h-2 rounded-[1px] bg-accent"
                  style={{ width: `${Math.round((issue.complaints / maxIssue) * 100)}%` }}
                />
              </span>
              <span className="tabular-nums">
                {issue.complaints}{" "}
                <span
                  className={
                    issue.trend === "up"
                      ? "text-negative"
                      : issue.trend === "down"
                        ? "text-positive"
                        : "text-muted"
                  }
                >
                  <span aria-hidden="true">{TREND_ARROWS[issue.trend]}</span>{" "}
                  <span className="sr-only sm:not-sr-only">{TREND_LABELS[issue.trend]}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No complaints this week.</p>
      )}
      {card.summaries.length > 0 ? (
        <div className="mt-3 space-y-1 text-sm text-muted">
          {card.summaries.slice(0, 3).map((s) => (
            <p key={s.issue}>{s.text}</p>
          ))}
        </div>
      ) : null}
    </article>
  );
}
