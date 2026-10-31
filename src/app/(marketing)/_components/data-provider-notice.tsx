import { snapshotRetention } from "@/sources/registry";
import { reddit } from "@/sources/reddit";
import type { Source } from "@/sources/types";

/**
 * Where Reddit posts come from (docs/PLAN.md 2.1.7, 2.3.12, D12): the data provider by name, what it
 * collects, that this is not a data license from Reddit, and how long it keeps snapshots. The same
 * text on the privacy notice and the sources page. On every deployment Reddit collection stays off
 * until the Reddit module states the snapshot retention (vendorClearance), which is what the last
 * paragraph promises. Every sentence here has a row in docs/claims.md; the retention text comes from
 * the module, so a test runs the copy gate over the rendered notice.
 */
export function DataProviderNotice({ source = reddit }: { source?: Source }) {
  const vendor = source.mode === "collect" ? source.vendor : undefined;
  const name = vendor?.name ?? "our data provider";
  const retention = snapshotRetention(source);
  return (
    <section aria-labelledby="data-provider" className="mt-8 space-y-3">
      <h2 id="data-provider" className="font-serif text-2xl tracking-tight">
        Reddit posts and our data provider
      </h2>
      <p>
        We get Reddit posts from {name}, a web data company that collects public Reddit pages for
        us, as a logged-out visitor would see them. This is not a data license from Reddit. We never
        log in to Reddit, and we never post, reply, vote or message there.
      </p>
      <p>
        From each post we keep the link, the community, when it was posted, a short excerpt, our own
        labels for it and a keyed hash of the author, never their username. Reddit posts are deleted
        from AskedFor 7 days after we collect them.
      </p>
      <p>
        {retention
          ? `${name} keeps the snapshots it delivers to us for ${retention}.`
          : `How long ${name} keeps the snapshots it delivers to us will be stated here before Reddit collection is switched on for AskedFor. Until then, it stays off.`}
      </p>
    </section>
  );
}
