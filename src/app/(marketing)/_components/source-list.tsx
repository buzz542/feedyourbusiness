import { isEnabled, vendorClearance } from "@/sources/registry";
import type { CollectSource, LinkSource, Source } from "@/sources/types";

/**
 * Every registered source as the sources page states it (docs/PLAN.md 4.2, 9.6 item 4, D12): how
 * posts are collected, how long they are kept, and the vendor for a vendor source. `HOW` must have
 * an entry for every collect source in the registry (a test checks), so a source cannot be added
 * without saying where its posts come from.
 */
export const HOW: Record<string, string> = {
  hackernews: "Through the official Hacker News search API (run by Algolia) and the item API.",
  bluesky: "Through the official Bluesky API, from AskedFor's own Bluesky account. Read only.",
  reddit:
    "Through Bright Data, a web data company that collects public Reddit pages for us. This is not a data license from Reddit.",
  x: "Through the official X API, only when we switch it on. It is off by default.",
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

const retention = (days: number) =>
  days === 7
    ? "Deleted from AskedFor 7 days after we collect it."
    : days === 30
      ? "Deleted from AskedFor 30 days after we collect it."
      : null;

const isOn = (source: CollectSource) =>
  isEnabled(source) &&
  vendorClearance(source) !== "dpa_missing" &&
  vendorClearance(source) !== "notice_missing";

export function SourceList({ sources }: { sources: readonly Source[] }) {
  const collect = sources.filter((s): s is CollectSource => s.mode === "collect");
  const links = sources.filter((s): s is LinkSource => s.mode === "link");
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
                {isOn(source) ? "Collecting now." : "Not switched on yet."}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="searches" className="mt-8 space-y-3">
        <h2 id="searches" className="font-serif text-2xl tracking-tight">
          Searches you open yourself
        </h2>
        <p>
          For {links.map((s) => s.displayName).join(", ")}, AskedFor gives you one-tap searches for
          your terms. They open in your own browser. We never fetch or store anything from these
          searches.
        </p>
        <p>
          We never collect posts from {NEVER_COLLECTED.join(", ")}, and we never access Product
          Hunt.
        </p>
        <p>
          We never post, reply, vote, follow or message on any platform, and we never write your
          replies.
        </p>
      </section>
    </>
  );
}
