import { isEnabled, isLaunchSource, vendorClearance } from "@/sources/registry";
import type { CollectSource, LinkSource, Source } from "@/sources/types";

/**
 * Every launch source as the sources page states it (docs/PLAN.md 4.2, 9.6 item 4, D12): how posts
 * are collected, how long they are kept, and the vendor for a vendor source. `HOW` must have an entry
 * for every launch collect source (`LAUNCH_COLLECT_SOURCES`; a test checks), so a source cannot be
 * added without saying where its posts come from. X is out of launch (8 Nov 2026): no card, and
 * the page says it is coming later.
 */
export const HOW: Record<string, string> = {
  hackernews: "Through the official Hacker News search API (run by Algolia) and the item API.",
  bluesky: "Through the official Bluesky API, from AskedFor's own Bluesky account. Read only.",
  reddit:
    "Through Bright Data, a web data company that collects public Reddit pages for us. This is not a data license from Reddit.",
};

export const NEVER_COLLECTED = [
  "LinkedIn",
  "Facebook",
  "Instagram",
  "TikTok",
  "Threads",
  "YouTube",
  "Discord",
];

/** "A, B and C", with each name once. */
export const listInWords = (names: readonly string[]) => {
  const unique = [...new Set(names)];
  return unique.length < 2
    ? (unique[0] ?? "")
    : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
};

const retention = (days: number) =>
  days === 7
    ? "Deleted from AskedFor 7 days after we collect it."
    : days === 30
      ? "Deleted from AskedFor 30 days after we collect it."
      : null;

/**
 * A vendor source held back on deployments because its DPA date is not set (2.1.7). Once the date
 * is set the paperwork sentence would be false; a hold for the snapshot retention is explained by
 * DataProviderNotice instead.
 */
const awaitsPaperwork = (source: CollectSource) => vendorClearance(source) === "dpa_missing";

const isOn = (source: CollectSource) =>
  isEnabled(source) &&
  vendorClearance(source) !== "dpa_missing" &&
  vendorClearance(source) !== "notice_missing";

export function SourceList({ sources }: { sources: readonly Source[] }) {
  const collect = sources.filter(
    (s): s is CollectSource => s.mode === "collect" && isLaunchSource(s),
  );
  // Only the searches the app offers today: a link source switched off is not listed.
  const links = sources.filter((s): s is LinkSource => s.mode === "link" && isEnabled(s));
  return (
    <>
      <section aria-labelledby="collected" className="mt-8 space-y-4">
        <h2 id="collected" className="font-serif text-2xl tracking-tight">
          Posts we collect
        </h2>
        <ul className="space-y-4">
          {collect.map((source) => (
            <li key={source.id} className="rounded-[2px] border border-rule p-4">
              <h3 className="font-medium">{source.displayName}</h3>
              <p className="mt-1">{HOW[source.id]}</p>
              {source.vendor ? (
                <p className="mt-1 text-sm text-muted">Data provider: {source.vendor.name}.</p>
              ) : null}
              <p className="mt-1 text-sm text-muted">{retention(source.retentionDays)}</p>
              <p className="mt-1 text-sm text-muted">
                {isOn(source) ? "Switched on." : "Not switched on yet."}
              </p>
              {source.vendor && awaitsPaperwork(source) ? (
                <p className="mt-1 text-sm text-muted">
                  It stays off until our data processing agreement with {source.vendor.name} and our
                  privacy impact assessment are signed.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <p>X is coming later.</p>
      </section>
      <section aria-labelledby="searches" className="mt-8 space-y-3">
        <h2 id="searches" className="font-serif text-2xl tracking-tight">
          Searches you open yourself
        </h2>
        {links.length > 0 ? (
          <p>
            For {listInWords(links.map((s) => s.displayName))}, AskedFor gives you one-tap searches
            for your terms. They open in your own browser. We never fetch or store anything from
            these searches.
          </p>
        ) : null}
        <p>
          We never collect posts from {listInWords(NEVER_COLLECTED)}, and we never collect anything
          from Product Hunt.
        </p>
        <p>
          We never post, reply, vote, follow or message for you on any platform, and we never write
          your replies.
        </p>
      </section>
    </>
  );
}
