import type { Metadata } from "next";
import { sources } from "@/sources/registry";
import type { CollectSource } from "@/sources/types";
import { BlueskyLinksNotice } from "../_components/bluesky-links-notice";
import { VendorNotice } from "../_components/vendor-notice";

export const metadata: Metadata = { title: "Where posts come from" };

/** How each collect source is reached, in plain words (docs/PLAN.md 9.6, D12). */
const HOW: Readonly<Record<string, string>> = {
  hackernews: "Hacker News Search by Algolia and the Hacker News item API.",
  bluesky: "Read-only, from AskedFor's own Bluesky account.",
  reddit: "Bright Data collects public Reddit pages for us, logged out. More below.",
  x: "The official X API, only when it is switched on.",
};

const access = (source: CollectSource) =>
  source.access === "vendor_api"
    ? `Through a data provider: ${source.vendor?.name}.`
    : "Through its official API.";

/**
 * The sources page (docs/PLAN.md 9.6): every source in the registry, how it is reached, how long
 * its posts are kept and the data provider. Built from the registry, so it cannot drift from it.
 */
export default function Page() {
  const collected = sources.filter((s): s is CollectSource => s.mode === "collect");
  const linked = sources.filter((s) => s.mode === "link").map((s) => s.displayName);
  return (
    <article>
      <h1 className="font-serif text-3xl tracking-tight">Where posts come from</h1>
      <p className="mt-4">
        AskedFor collects public posts that match your search terms from the sources below and links
        each one back to where it was posted. We never post, reply, vote or message on any platform,
        and we never write your replies.
      </p>

      <h2 className="mt-10 font-serif text-xl tracking-tight">Collected</h2>
      <ul className="mt-4 space-y-6">
        {collected.map((source) => (
          <li key={source.id}>
            <h3 className="font-medium">{source.displayName}</h3>
            <p className="mt-1">
              {access(source)} {HOW[source.id] ?? ""}
            </p>
            <p className="mt-1 text-muted">
              Deleted from AskedFor after {source.retentionDays} days.
            </p>
            {source.id === "bluesky" ? (
              <div className="mt-1 text-muted">
                <BlueskyLinksNotice />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <h2 className="mt-10 font-serif text-xl tracking-tight">Searches you open yourself</h2>
      <p className="mt-4">
        For these, AskedFor collects nothing. It builds a search link from your terms and you open
        it in your own browser: {linked.join(", ")}.
      </p>

      <VendorNotice />
    </article>
  );
}
