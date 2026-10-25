import type { Metadata } from "next";
import { after } from "next/server";
import { ThemeCard } from "@/components/app/build/theme-card";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePage } from "@/server/auth/app-state";
import { loadBuild } from "@/server/build/load";
import type { BuildTheme } from "@/server/build/view";
import { createSupabaseEventSink } from "@/server/events/sink";
import { track } from "@/server/events/track";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Build" };

type Params = Record<string, string | string[] | undefined>;

const weekLabel = (week: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${week}T00:00:00Z`),
  );

function Section({
  id,
  title,
  items,
  empty,
}: {
  id: string;
  title: string;
  items: BuildTheme[];
  empty: string;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="font-serif text-xl tracking-tight">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((t) => (
            <ThemeCard key={t.id} theme={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Build tab (docs/PLAN.md 4.6): the patterns behind the posts, week by week. */
export default async function BuildPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { user, state } = await requirePage("build", "/app/build");
  const db = await createSupabaseServerClient();
  const view = await loadBuild(db, state.product!.id, params.week);
  after(() => track(createSupabaseEventSink(), "build_opened", user.id, {}, new Date()));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-serif text-3xl tracking-tight">Build</h1>
        {view.week ? (
          <div className="flex flex-wrap items-center gap-2">
            <form method="get" action="/app/build" className="flex items-center gap-2">
              <label htmlFor="week" className="text-sm text-muted">
                Week of
              </label>
              <select
                id="week"
                name="week"
                defaultValue={view.week}
                className="min-h-10 rounded-[2px] border border-rule-strong bg-paper px-2 text-sm"
              >
                {view.weeks.map((w) => (
                  <option key={w} value={w}>
                    {weekLabel(w)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="inline-flex min-h-10 items-center rounded-[2px] border border-rule-strong px-3 text-sm hover:bg-sunk"
              >
                Show
              </button>
            </form>
            <a
              href={`/api/export/build?week=${view.week}`}
              className="inline-flex min-h-10 items-center rounded-[2px] border border-rule-strong px-3 text-sm hover:bg-sunk"
            >
              Export (Markdown)
            </a>
          </div>
        ) : null}
      </div>

      {!view.week ? (
        <EmptyState
          title="Your first weekly report is on its way"
          body="Themes appear here after the weekly report on Sunday evening, once a week has enough posts."
        />
      ) : (
        <>
          <Section
            id="themes"
            title="Themes this week"
            items={view.groups.themes}
            empty="No themes this week."
          />
          <Section
            id="wishes"
            title="Wished it existed"
            items={view.groups.wishes}
            empty="No wishes this week."
          />
          <Section
            id="next"
            title="What to build next"
            items={view.groups.next}
            empty="No suggestions this week."
          />
        </>
      )}
    </div>
  );
}
