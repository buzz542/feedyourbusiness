import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { ChevronIcon, CloseIcon, FilterIcon, SearchIcon } from "@/components/ui/icons";
import { CATEGORY_LABELS, SOURCE_LABELS } from "@/server/reply/tips";
import {
  activeFilterKeys,
  CATEGORIES,
  clearFiltersHref,
  feedHref,
  type FeedFilter,
  type FeedSource,
  type FilterKey,
  withEnabledSource,
} from "@/server/store/feed";

const FIELD =
  "h-9 rounded-[2px] border border-control bg-surface px-2.5 text-sm text-ink hover:border-ink";

function Field({ label, grow, children }: { label: string; grow?: boolean; children: ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${grow ? "col-span-2" : ""}`}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * Reply filters across the top (docs/PLAN.md 4.4), as a plain GET form, so every view can be
 * bookmarked and the form works without JavaScript. Under it, how many filters are on and one
 * link per filter that removes it. On a phone the form folds away under a summary with the count.
 *
 * `sources` are the collect sources switched on now: a source behind its gate (Reddit until 2.1.7
 * holds, X out of launch) is not offered. The page drops one the address asks for
 * (withEnabledSource), so it is never shown as a filter either.
 */
export function FilterBar({
  filter: asked,
  defaultMin,
  rivals,
  sources,
}: {
  filter: FeedFilter;
  defaultMin: number;
  rivals: readonly { id: string; name: string }[];
  sources: readonly FeedSource[];
}) {
  const filter = withEnabledSource(asked, sources);
  const active = activeFilterKeys(filter, defaultMin);
  const count = active.length;
  const rivalName = rivals.find((r) => r.id === filter.rival)?.name ?? "not tracked";
  const labels: Record<FilterKey, string> = {
    category: `Category: ${filter.category ? CATEGORY_LABELS[filter.category] : ""}`,
    source: `Source: ${filter.source ? SOURCE_LABELS[filter.source] : ""}`,
    rival: `Rival: ${rivalName}`,
    min: `Minimum match: ${filter.min}%`,
    q: `Search: ${filter.q ?? ""}`,
  };

  const view =
    filter.view !== "today" ? <input type="hidden" name="view" value={filter.view} /> : null;
  const search = (
    <Field label="Search" grow>
      <span className="relative flex">
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-muted">
          <SearchIcon />
        </span>
        <input
          type="search"
          name="q"
          maxLength={100}
          defaultValue={filter.q ?? ""}
          placeholder="Words in the post"
          className={`${FIELD} w-full pl-8 placeholder:text-muted`}
        />
      </span>
    </Field>
  );
  const choices = (
    <>
      <Field label="Category">
        <select name="category" defaultValue={filter.category ?? ""} className={FIELD}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>
      {sources.length >= 2 ? (
        <Field label="Source">
          <select name="source" defaultValue={filter.source ?? ""} className={FIELD}>
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {rivals.length > 0 ? (
        <Field label="Rival">
          <select name="rival" defaultValue={filter.rival ?? ""} className={FIELD}>
            <option value="">Any rival</option>
            {rivals.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Minimum match">
        <input
          type="number"
          name="min"
          min={40}
          max={95}
          step={1}
          inputMode="numeric"
          defaultValue={filter.min ?? defaultMin}
          className={`${FIELD} sm:w-24`}
        />
      </Field>
    </>
  );
  const apply = (
    <button type="submit" className={buttonClass("secondary", "col-span-2 self-end")}>
      Apply
    </button>
  );

  return (
    <section aria-labelledby="filters" className="flex flex-col gap-3">
      <h2 id="filters" className="sr-only">
        Filters
      </h2>
      <form
        method="get"
        action="/app/reply"
        role="search"
        aria-label="Filter posts"
        className="hidden flex-col gap-3 sm:flex"
      >
        {view}
        {search}
        <div className="flex flex-wrap items-end gap-3">
          {choices}
          {apply}
        </div>
      </form>
      <details className="group rounded-[2px] border border-rule bg-surface sm:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <FilterIcon />
          Filters
          {count > 0 ? (
            <>
              <span
                data-filter-count=""
                className="rounded-full bg-selected px-2 text-xs leading-5 tabular-nums"
              >
                {count}
              </span>
              <span className="sr-only"> on</span>
            </>
          ) : null}
          <ChevronIcon className="ml-auto transition-transform group-open:rotate-90" />
        </summary>
        <form
          method="get"
          action="/app/reply"
          role="search"
          aria-label="Filter posts"
          className="grid grid-cols-2 gap-3 border-t border-rule p-3"
        >
          {view}
          {choices}
          {search}
          {apply}
        </form>
      </details>
      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p className="text-muted">
            <span data-filter-count="" className="font-medium text-ink tabular-nums">
              {count}
            </span>{" "}
            {count === 1 ? "filter" : "filters"} on
          </p>
          {active.map((key) => (
            <Link
              key={key}
              href={feedHref(filter, { [key]: undefined })}
              data-remove-filter={key}
              className="inline-flex max-w-full items-center gap-1 rounded-[3px] border border-control bg-surface py-0.5 pr-1.5 pl-2 text-xs leading-5 hover:border-ink"
            >
              <span className="sr-only">Remove filter </span>
              <span className="truncate">{labels[key]}</span>
              <CloseIcon size={12} />
            </Link>
          ))}
          <Link
            href={clearFiltersHref(filter)}
            className="text-accent underline underline-offset-2"
          >
            Clear all
          </Link>
        </div>
      ) : null}
    </section>
  );
}
