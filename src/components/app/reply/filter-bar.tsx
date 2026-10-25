import { CATEGORY_LABELS, SOURCE_LABELS } from "@/lib/reply-tips";
import { FEED_CATEGORIES, FEED_SOURCES, type FeedFilters } from "@/lib/reply-filters";

/**
 * The Reply filters (docs/PLAN.md 4.4) as a plain GET form, so every view lives in the URL and can
 * be bookmarked. Collapsed into a disclosure unless a filter is in use.
 */
export function FilterBar({
  filters,
  rivals,
  sources = FEED_SOURCES,
  threshold,
}: {
  filters: FeedFilters;
  rivals: readonly { id: string; name: string }[];
  sources?: readonly string[];
  threshold: number;
}) {
  const active =
    filters.category !== null ||
    filters.source !== null ||
    filters.rival !== null ||
    filters.q !== null ||
    filters.min !== threshold;
  const select =
    "min-h-10 w-full rounded-[2px] border border-rule-strong bg-paper px-2 text-sm text-ink";
  return (
    <details open={active} className="rounded-[2px] border border-rule p-3">
      <summary className="inline-flex min-h-10 cursor-pointer items-center text-sm font-medium">
        Filters{active ? " (on)" : ""}
      </summary>
      <form method="get" action="/app/reply" className="mt-3 grid gap-3 sm:grid-cols-6">
        {filters.view !== "today" ? <input type="hidden" name="view" value={filters.view} /> : null}
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-muted">Search within posts</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            maxLength={100}
            className={select}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Category</span>
          <select name="category" defaultValue={filters.category ?? ""} className={select}>
            <option value="">All</option>
            {FEED_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Source</span>
          <select name="source" defaultValue={filters.source ?? ""} className={select}>
            <option value="">All</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Rival</span>
          <select name="rival" defaultValue={filters.rival ?? ""} className={select}>
            <option value="">Any</option>
            {rivals.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Minimum match</span>
          <input
            type="number"
            name="min"
            min={40}
            max={95}
            step={5}
            defaultValue={filters.min}
            className={select}
          />
        </label>
        <div className="flex items-end gap-2 sm:col-span-6">
          <button
            type="submit"
            className="inline-flex min-h-10 items-center rounded-[2px] bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            Apply
          </button>
          <a
            href={filters.view === "today" ? "/app/reply" : `/app/reply?view=${filters.view}`}
            className="inline-flex min-h-10 items-center px-2 text-sm underline-offset-4 hover:underline"
          >
            Clear filters
          </a>
        </div>
      </form>
    </details>
  );
}
