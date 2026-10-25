import { DISCLOSURE, whereLabel } from "@/lib/reply-tips";
import { KIND_LABELS, type BuildTheme } from "@/server/build/view";
import { TREND_ARROWS, TREND_LABELS } from "@/server/rivals/view";
import { Tag } from "@/components/ui/tag";

/**
 * A Build theme (docs/PLAN.md 4.6): kind, count, trend in words, our own summary, and up to 3
 * linked posts while they still exist, with "Say you built it." No names, handles or quotes.
 */
export function ThemeCard({ theme }: { theme: BuildTheme }) {
  return (
    <li className="rounded-[2px] border border-rule bg-paper p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Tag>{KIND_LABELS[theme.kind]}</Tag>
        <span className="tabular-nums">
          {theme.count} {theme.count === 1 ? "post" : "posts"}
        </span>
        <span className="text-muted">
          <span aria-hidden="true">{TREND_ARROWS[theme.trend]}</span> {TREND_LABELS[theme.trend]}
        </span>
      </div>
      <h3 className="mt-2 font-medium">{theme.title}</h3>
      <p className="mt-1 text-sm text-muted">{theme.summary}</p>
      {theme.evidence.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {theme.evidence.map((e) => (
            <a
              key={e.id}
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              {whereLabel(e.source, e.community)}
            </a>
          ))}
          <span className="font-medium">{DISCLOSURE}</span>
        </div>
      ) : null}
    </li>
  );
}
