import { ISSUES, type Issue } from "@/server/classify/schema";
import { previousWeek, trendFor } from "@/server/synthesis/checks";

/**
 * The Rivals tab's view model (docs/PLAN.md 4.5), built from the database's counts: this week live
 * from our labels (rival_counts), earlier weeks from the weekly insights, which outlive the posts.
 * Pure, so the numbers are tested without a database.
 */

export const ISSUE_LABELS: Readonly<Record<Issue, string>> = {
  pricing: "Pricing",
  reliability: "Reliability",
  missing_feature: "Missing feature",
  support: "Support",
  usability: "Usability",
  performance: "Performance",
  integration: "Integrations",
  other: "Other",
};

export interface CountRow {
  competitorId: string | null;
  toolName: string | null;
  issue: string;
  complaints: number;
  switching: number;
}

export interface InsightRow extends CountRow {
  week: string;
  summary: string;
}

export interface Scorecard {
  key: string;
  name: string;
  complaints: number;
  switching: number;
  issues: {
    issue: Issue;
    label: string;
    complaints: number;
    trend: "new" | "up" | "down" | "flat";
  }[];
  /** Complaints per week, oldest first: 8 earlier weeks then this week. */
  history: number[];
  summaries: { issue: Issue; text: string }[];
}

const isIssue = (s: string): s is Issue => (ISSUES as readonly string[]).includes(s);

export const rivalKeyOf = (r: { competitorId: string | null; toolName: string | null }) =>
  r.competitorId ? `c:${r.competitorId}` : `t:${(r.toolName ?? "").toLowerCase()}`;

/** The 8 weeks before `week`, oldest first. */
export function earlierWeeks(week: string, n = 8): string[] {
  const out: string[] = [];
  let w = week;
  for (let i = 0; i < n; i++) {
    w = previousWeek(w);
    out.unshift(w);
  }
  return out;
}

export function buildScorecards(input: {
  week: string;
  thisWeek: readonly CountRow[];
  insights: readonly InsightRow[];
  names: ReadonlyMap<string, string>;
  /** "all" (tracked only), a rival key, or "discovered" (untracked tools only). */
  pick: string;
}): Scorecard[] {
  const weeks = earlierWeeks(input.week);
  const lastWeek = weeks[weeks.length - 1]!;
  const wanted = (key: string) =>
    input.pick === "all"
      ? key.startsWith("c:")
      : input.pick === "discovered"
        ? key.startsWith("t:")
        : key === input.pick;

  const keys = new Set<string>();
  for (const r of input.thisWeek) keys.add(rivalKeyOf(r));
  for (const r of input.insights) keys.add(rivalKeyOf(r));
  if (input.pick.startsWith("c:")) keys.add(input.pick);

  const cards: Scorecard[] = [];
  for (const key of keys) {
    if (!wanted(key)) continue;
    const now = input.thisWeek.filter((r) => rivalKeyOf(r) === key && isIssue(r.issue));
    const past = input.insights.filter((r) => rivalKeyOf(r) === key);
    const byIssue = new Map<Issue, number>();
    for (const r of now)
      byIssue.set(r.issue as Issue, (byIssue.get(r.issue as Issue) ?? 0) + r.complaints);
    const lastByIssue = new Map<string, number>();
    for (const r of past.filter((p) => p.week === lastWeek))
      lastByIssue.set(r.issue, (lastByIssue.get(r.issue) ?? 0) + r.complaints);
    const name =
      input.names.get(key) ??
      now.find((r) => r.toolName)?.toolName ??
      past.find((r) => r.toolName)?.toolName ??
      "Unknown";
    cards.push({
      key,
      name,
      complaints: now.reduce((s, r) => s + r.complaints, 0),
      switching: now.reduce((s, r) => s + r.switching, 0),
      issues: [...byIssue.entries()]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([issue, complaints]) => ({
          issue,
          label: ISSUE_LABELS[issue],
          complaints,
          trend: trendFor(complaints, lastByIssue.get(issue)),
        })),
      history: [
        ...weeks.map((w) => past.filter((r) => r.week === w).reduce((s, r) => s + r.complaints, 0)),
        now.reduce((s, r) => s + r.complaints, 0),
      ],
      summaries: past
        .filter((r) => r.summary && isIssue(r.issue))
        .sort((a, b) => b.week.localeCompare(a.week))
        .filter((r, i, all) => all.findIndex((x) => x.issue === r.issue) === i)
        .map((r) => ({ issue: r.issue as Issue, text: r.summary })),
    });
  }
  return cards.sort((a, b) => b.complaints - a.complaints || a.name.localeCompare(b.name));
}

export const TREND_LABELS = {
  new: "new this week",
  up: "up from last week",
  down: "down from last week",
  flat: "about the same as last week",
} as const;

export const TREND_ARROWS = { new: "•", up: "↑", down: "↓", flat: "→" } as const;
