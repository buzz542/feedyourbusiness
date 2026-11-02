import { buttonClass } from "@/components/ui/button";
import { CATEGORY_LABELS, SOURCE_LABELS } from "@/server/reply/tips";
import { CATEGORIES, FEED_SOURCES, type FeedFilter } from "@/server/store/feed";

const field = "rounded-sm border border-rule bg-paper px-2 py-1 text-sm";

/**
 * Reply filters (docs/PLAN.md 4.4) as a plain GET form, so every view can be bookmarked and the
 * form works without JavaScript. The view stays as a hidden field.
 */
export function FilterBar({
  filter,
  defaultMin,
  rivals,
}: {
  filter: FeedFilter;
  defaultMin: number;
  rivals: readonly { id: string; name: string }[];
}) {
  return (
    <form method="get" action="/app/reply" className="flex flex-wrap items-end gap-3" role="search">
      {filter.view !== "today" ? <input type="hidden" name="view" value={filter.view} /> : null}
      <label className="flex flex-col gap-1 text-sm">
        Category
        <select name="category" defaultValue={filter.category ?? ""} className={field}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Source
        <select name="source" defaultValue={filter.source ?? ""} className={field}>
          <option value="">All sources</option>
          {FEED_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      {rivals.length > 0 ? (
        <label className="flex flex-col gap-1 text-sm">
          Rival
          <select name="rival" defaultValue={filter.rival ?? ""} className={field}>
            <option value="">Any rival</option>
            {rivals.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        Minimum match
        <input
          type="number"
          name="min"
          min={40}
          max={95}
          step={5}
          defaultValue={filter.min ?? defaultMin}
          className={`${field} w-20`}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Search
        <input
          type="search"
          name="q"
          maxLength={100}
          defaultValue={filter.q ?? ""}
          placeholder="Words in the post"
          className={field}
        />
      </label>
      <button type="submit" className={buttonClass("secondary")}>
        Apply
      </button>
    </form>
  );
}
