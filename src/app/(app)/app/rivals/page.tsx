import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { PostCard } from "@/components/app/reply/post-card";
import { RivalScorecard } from "@/components/app/rivals/rival-scorecard";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/empty-state";
import { DISCLOSURE, whereLabel } from "@/lib/reply-tips";
import { requirePage } from "@/server/auth/app-state";
import { createSupabaseEventSink } from "@/server/events/sink";
import { track } from "@/server/events/track";
import { loadRivals } from "@/server/rivals/load";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { setPostStateAction } from "../reply/actions";
import { trackToolAction } from "./actions";

export const metadata: Metadata = { title: "Rivals" };

type Params = Record<string, string | string[] | undefined>;

/** The Rivals tab (docs/PLAN.md 4.5): what your competitors get wrong, and who wants to switch. */
export default async function RivalsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { user, state } = await requirePage("rivals", "/app/rivals");
  const db = await createSupabaseServerClient();
  const now = new Date();
  const view = await loadRivals(db, state.product!.id, now, params.rival);
  const back =
    view.pick === "all"
      ? "/app/rivals"
      : `/app/rivals?rival=${view.pick === "discovered" ? "discovered" : view.pick.slice(2)}`;
  const tracked = typeof params.tracked === "string" ? params.tracked.slice(0, 60) : null;

  after(() =>
    track(
      createSupabaseEventSink(),
      "rivals_opened",
      user.id,
      {
        rival: view.pick === "all" ? "all" : view.pick === "discovered" ? "discovered" : "tracked",
      },
      new Date(),
    ),
  );

  const picks = [
    { href: "/app/rivals", label: "All tracked", value: "all" },
    ...view.competitors.map((c) => ({
      href: `/app/rivals?rival=${c.id}`,
      label: c.name,
      value: `c:${c.id}`,
    })),
    { href: "/app/rivals?rival=discovered", label: "Discovered", value: "discovered" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-serif text-3xl tracking-tight">Rivals</h1>
        <a
          href={`/api/export/rivals?week=${view.week}`}
          className="inline-flex min-h-10 items-center rounded-[2px] border border-rule-strong px-3 text-sm hover:bg-sunk"
        >
          Export this week (Markdown)
        </a>
      </div>

      {tracked ? (
        <p role="status" className="rounded-[2px] border border-rule bg-sunk p-3 text-sm">
          Now tracking {tracked}. Its alternative search term was added to your terms.
        </p>
      ) : null}

      <nav aria-label="Rival">
        <ul className="flex flex-wrap gap-2">
          {picks.map((p) => (
            <li key={p.value}>
              <Link
                href={p.href}
                aria-current={view.pick === p.value ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-10 items-center rounded-[2px] border px-3 text-sm",
                  view.pick === p.value
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-rule-strong hover:bg-sunk",
                )}
              >
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="this-week" className="space-y-3">
        <h2 id="this-week" className="font-serif text-xl tracking-tight">
          This week
        </h2>
        {view.scorecards.length === 0 ? (
          <EmptyState
            title={
              view.competitors.length === 0 ? "No rivals tracked yet" : "No complaints this week"
            }
            body={
              view.competitors.length === 0 ? (
                <>
                  Add competitors in{" "}
                  <Link href="/app/settings" className="underline underline-offset-4">
                    Settings
                  </Link>
                  , or track a tool from Discovered.
                </>
              ) : (
                "Complaints about your rivals appear here as posts arrive."
              )
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {view.scorecards.map((card) => (
              <RivalScorecard key={card.key} card={card} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="switching" className="space-y-3">
        <h2 id="switching" className="font-serif text-xl tracking-tight">
          People looking to switch
        </h2>
        {view.switchers.length === 0 ? (
          <p className="text-sm text-muted">Nobody this week yet.</p>
        ) : (
          <ul className="space-y-3">
            {view.switchers.map((card) => (
              <PostCard
                key={card.id}
                card={card}
                now={now}
                action={setPostStateAction}
                back={back}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="fixes" className="space-y-3">
        <h2 id="fixes" className="font-serif text-xl tracking-tight">
          What you could fix
        </h2>
        {view.fixes.length === 0 ? (
          <p className="text-sm text-muted">
            Ideas appear here after the weekly report, on Sunday evenings.
          </p>
        ) : (
          <ul className="space-y-3">
            {view.fixes.map((fix) => (
              <li key={fix.title} className="rounded-[2px] border border-rule p-4">
                <h3 className="font-medium">{fix.title}</h3>
                <p className="mt-1 text-sm text-muted">{fix.summary}</p>
                {fix.evidence.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    {fix.evidence.map((e) => (
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
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="discovered" className="space-y-3">
        <h2 id="discovered" className="font-serif text-xl tracking-tight">
          Discovered tools
        </h2>
        <p className="text-sm text-muted">
          Tools people in your space mention that you do not track, from the last four weeks.
        </p>
        {view.discovered.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-rule rounded-[2px] border border-rule">
            {view.discovered.map((tool) => (
              <li key={tool.name} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span>
                  {tool.name}{" "}
                  <span className="tabular-nums text-muted">
                    ({tool.mentions} {tool.mentions === 1 ? "mention" : "mentions"})
                  </span>
                </span>
                <form action={trackToolAction}>
                  <input type="hidden" name="name" value={tool.name} />
                  <button
                    type="submit"
                    className="inline-flex min-h-10 items-center rounded-[2px] border border-rule-strong px-3 hover:bg-sunk"
                  >
                    Track
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
