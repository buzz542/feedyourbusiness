import type { Evidence } from "@/server/rivals/load";

/** The Build tab's shapes (docs/PLAN.md 4.6). Aggregates kept after the posts expire. */

export interface BuildTheme {
  id: string;
  kind: "ask" | "wish" | "pain" | "opportunity" | "rival_fix";
  themeKey: string | null;
  title: string;
  summary: string;
  count: number;
  trend: "new" | "up" | "down" | "flat";
  /** Linked posts while they are still stored; empty once they expire. */
  evidence: Evidence[];
}

export interface BuildGroups {
  /** Asks and pains: the themes this week, up to 8. */
  themes: BuildTheme[];
  wishes: BuildTheme[];
  /** What to build next: opportunities across asks, wishes and rival gaps, up to 3. */
  next: BuildTheme[];
}

export interface BuildView {
  week: string | null;
  weeks: string[];
  groups: BuildGroups;
}

export const KIND_LABELS: Readonly<Record<BuildTheme["kind"], string>> = {
  ask: "Ask",
  wish: "Wish",
  pain: "Pain",
  opportunity: "Opportunity",
  rival_fix: "Rival gap",
};

export function groupThemes(themes: readonly BuildTheme[]): BuildGroups {
  const byCount = (a: BuildTheme, b: BuildTheme) =>
    b.count - a.count || a.title.localeCompare(b.title);
  return {
    themes: themes
      .filter((t) => t.kind === "ask" || t.kind === "pain")
      .sort(byCount)
      .slice(0, 8),
    wishes: themes.filter((t) => t.kind === "wish").sort(byCount),
    next: themes
      .filter((t) => t.kind === "opportunity" || t.kind === "rival_fix")
      .sort(byCount)
      .slice(0, 3),
  };
}
