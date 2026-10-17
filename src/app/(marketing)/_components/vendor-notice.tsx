import { sources } from "@/sources/registry";

const reddit = sources.find((s) => s.id === "reddit");

/**
 * Names the Reddit data provider (docs/PLAN.md 2.1.7, 9.6), on the privacy notice and the sources
 * page alike. The solicitor reviews the wording before launch.
 */
export function VendorNotice() {
  return (
    <section aria-labelledby="vendor-notice" className="mt-10 space-y-3">
      <h2 id="vendor-notice" className="font-serif text-xl tracking-tight">
        Reddit posts and Bright Data
      </h2>
      <p>
        Reddit posts reach AskedFor through Bright Data, a web data company that collects public
        Reddit pages for us, logged out. Bright Data works for us as a processor under a data
        processing agreement. This is not a data license from Reddit.
      </p>
      {reddit?.mode === "collect" ? (
        <p>
          We keep only the posts that match a customer&apos;s product, with a link back to Reddit,
          and delete them from AskedFor after {reddit.retentionDays} days.
        </p>
      ) : null}
      <p>
        How long Bright Data keeps the snapshots it delivers to us is being confirmed with Bright
        Data, and is stated here before any Reddit post is collected.
      </p>
    </section>
  );
}
