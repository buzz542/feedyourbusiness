import type { Metadata } from "next";
import { ReviewForm } from "@/components/app/onboarding/review-form";
import { PlanControls } from "@/components/app/settings/plan-controls";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/server/auth/app-state";
import { getBillingCore } from "@/server/billing/deps";
import { planStatus } from "@/server/billing/plan-status";
import type { PriceTerms } from "@/server/billing/terms";
import { loadDraftView } from "@/server/onboarding/load-draft";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { collectSources } from "@/sources/registry";
import {
  deleteAccountAction,
  saveEmailPrefsAction,
  saveSettingsProfileAction,
  setPausedAction,
} from "./actions";

export const metadata: Metadata = { title: "Settings" };

type Params = Record<string, string | string[] | undefined>;

async function loadPrice(): Promise<PriceTerms | null> {
  try {
    const { stripe, config } = getBillingCore();
    const p = await stripe.getPrice(config.priceId);
    return p.unitAmount != null && p.interval
      ? {
          unitAmount: p.unitAmount,
          currency: p.currency,
          interval: p.interval,
          intervalCount: p.intervalCount ?? 1,
        }
      : null;
  } catch {
    return null;
  }
}

const day = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "Europe/London" }).format(d)
    : null;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20 border-t border-rule pt-6"
    >
      <h2 id={`${id}-title`} className="font-serif text-2xl tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

const sevenDaysAgo = () => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

/** Settings (docs/PLAN.md 4.7): plan and billing, email, product and terms, sources, data. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { user, state } = await requirePage("settings", "/app/settings");
  const db = await createSupabaseServerClient();
  const [profile, price] = await Promise.all([
    db
      .from("profiles")
      .select(
        "subscription_status, trial_end, current_period_end, cancel_at_period_end, email_daily, email_weekly",
      )
      .eq("id", user.id)
      .maybeSingle(),
    loadPrice(),
  ]);
  if (profile.error) throw new Error("Supabase: could not load settings");
  const p = profile.data;
  const status = planStatus(
    {
      subscriptionStatus: p?.subscription_status ?? null,
      trialEnd: p?.trial_end ? new Date(p.trial_end) : null,
      currentPeriodEnd: p?.current_period_end ? new Date(p.current_period_end) : null,
      cancelAtPeriodEnd: p?.cancel_at_period_end ?? false,
    },
    price,
  );
  const draft = state.product ? await loadDraftView(db, state.product.id) : null;
  const confirmed = state.product && state.product.status !== "draft";

  // Per-term stats for the last 7 days (fetched, relevant).
  const since = sevenDaysAgo();
  const stats = state.product
    ? ((
        await db
          .from("term_stats")
          .select("fetched, relevant, search_terms!inner(term, product_id)")
          .eq("search_terms.product_id", state.product.id)
          .gte("day", since)
      ).data ?? [])
    : [];
  const byTerm = new Map<string, { fetched: number; relevant: number }>();
  for (const row of stats) {
    const t = Array.isArray(row.search_terms) ? row.search_terms[0] : row.search_terms;
    if (!t) continue;
    const cur = byTerm.get(t.term) ?? { fetched: 0, relevant: 0 };
    cur.fetched += row.fetched;
    cur.relevant += row.relevant;
    byTerm.set(t.term, cur);
  }
  const saved = typeof params.saved === "string" ? params.saved : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="font-serif text-3xl tracking-tight">Settings</h1>
      {saved ? (
        <p role="status" className="rounded-[2px] border border-rule bg-sunk p-3 text-sm">
          Saved.
        </p>
      ) : null}

      <Section id="plan" title="Plan and billing">
        {status.pastDue ? (
          <p
            role="alert"
            className="mt-3 rounded-[2px] border border-negative p-3 text-sm text-negative"
          >
            Your last payment did not go through. Update your card to keep AskedFor running.
          </p>
        ) : null}
        <p className="mt-3">{status.headline}</p>
        {status.detail ? <p className="mt-1 text-sm text-muted">{status.detail}</p> : null}
        {status.canStart ? (
          <div className="mt-4">
            <Button href="/app/billing">Start free trial</Button>
          </div>
        ) : (
          <PlanControls
            canCancel={status.canCancel}
            canResume={status.canResume}
            canUpdateCard={status.canUpdateCard}
            accessUntil={day(status.accessUntil)}
          />
        )}
      </Section>

      <Section id="email" title="Email">
        <form action={saveEmailPrefsAction} className="mt-3 space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="daily"
              defaultChecked={p?.email_daily ?? true}
              className="mt-1 size-4 accent-[var(--accent)]"
            />
            <span>
              Daily posts email
              <span className="block text-sm text-muted">
                New posts worth replying to, each morning when there are any.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="weekly"
              defaultChecked={p?.email_weekly ?? true}
              className="mt-1 size-4 accent-[var(--accent)]"
            />
            <span>
              Monday digest
              <span className="block text-sm text-muted">
                Themes, rival changes and what to build next.
              </span>
            </span>
          </label>
          <Button type="submit" variant="secondary">
            Save email settings
          </Button>
        </form>
      </Section>

      <Section id="product" title="Product, search terms and competitors">
        {confirmed ? (
          <form action={setPausedAction} className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span>
              Collection is <strong>{state.product!.status === "paused" ? "paused" : "on"}</strong>.
            </span>
            <input
              type="hidden"
              name="paused"
              value={state.product!.status === "paused" ? "0" : "1"}
            />
            <Button type="submit" variant="secondary">
              {state.product!.status === "paused" ? "Resume collection" : "Pause collection"}
            </Button>
          </form>
        ) : null}
        {byTerm.size > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="text-left text-muted">Last 7 days, per search term</caption>
              <thead>
                <tr className="text-left">
                  <th className="py-1 pr-4 font-medium">Term</th>
                  <th className="py-1 pr-4 font-medium">Fetched</th>
                  <th className="py-1 font-medium">Relevant</th>
                </tr>
              </thead>
              <tbody>
                {[...byTerm.entries()].map(([term, s]) => (
                  <tr key={term} className="border-t border-rule">
                    <td className="py-1 pr-4">{term}</td>
                    <td className="py-1 pr-4 tabular-nums">{s.fetched}</td>
                    <td className="py-1 tabular-nums">{s.relevant}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {draft ? (
          <ReviewForm
            key={draft.updatedAt}
            draft={draft.view}
            saved={saved === "product"}
            mode="settings"
            saveAction={saveSettingsProfileAction}
          />
        ) : (
          <p className="mt-3 text-sm text-muted">Set up your product in onboarding first.</p>
        )}
      </Section>

      <Section id="sources" title="Sources">
        <p className="mt-3 text-sm text-muted">
          Where your posts come from right now. Hacker News and Bluesky through their official APIs,
          Reddit through a web data company (named on our sources page), X through its official API
          when it is switched on.
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {collectSources().length === 0 ? <li>No source is switched on yet.</li> : null}
          {collectSources().map((s) => (
            <li key={s.id}>{s.displayName}</li>
          ))}
        </ul>
      </Section>

      <Section id="data" title="Your data">
        <p className="mt-3 text-sm text-muted">
          Download everything AskedFor holds for your account, as JSON. Posts appear as links with
          our labels.
        </p>
        <div className="mt-3">
          <Button href="/api/export" variant="secondary">
            Export my data
          </Button>
        </div>
        <form
          action={deleteAccountAction}
          className="mt-6 space-y-3 rounded-[2px] border border-rule p-4"
        >
          <h3 className="font-medium">Delete my account</h3>
          <p className="text-sm text-muted">
            This cancels your subscription at once, with no further charge, and deletes your account
            and everything in it. It cannot be undone.
          </p>
          {params.error === "delete" ? (
            <p role="alert" className="text-sm text-negative">
              Type DELETE to confirm.
            </p>
          ) : null}
          <label className="block text-sm">
            Type DELETE to confirm
            <input
              name="confirm"
              autoComplete="off"
              className="mt-1 block min-h-10 w-full max-w-xs rounded-[2px] border border-rule-strong bg-paper px-2"
            />
          </label>
          <Button type="submit" variant="secondary">
            Delete my account
          </Button>
        </form>
      </Section>
    </div>
  );
}
