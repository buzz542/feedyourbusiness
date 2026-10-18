import { dpaSignedOn, sources } from "@/sources/registry";

const reddit = sources.find((s) => s.id === "reddit");

/**
 * Names the Reddit data provider (docs/PLAN.md 2.1.7, 9.6), on the privacy notice and the sources
 * page alike. It states the DPA only once its date is set, and the snapshot retention only once
 * the Reddit module declares it; until then it says Reddit stays off, which vendorClearance
 * enforces on every deployment. The solicitor reviews the wording before launch.
 */
export function VendorNotice({
  dpaSignedOn: signedOn = reddit ? dpaSignedOn(reddit) : null,
  snapshotRetention = reddit?.mode === "collect"
    ? (reddit.vendor?.snapshotRetention ?? null)
    : null,
}: { dpaSignedOn?: string | null; snapshotRetention?: string | null } = {}) {
  return (
    <section aria-labelledby="vendor-notice" className="mt-10 space-y-3">
      <h2 id="vendor-notice" className="font-serif text-xl tracking-tight">
        Reddit posts and Bright Data
      </h2>
      <p>
        Reddit posts reach AskedFor only through Bright Data, a web data company that collects
        public Reddit pages for us, logged out. This is not a data license from Reddit.
      </p>
      <p>
        {signedOn
          ? "Bright Data works for us as a processor under a data processing agreement."
          : "Reddit collection stays switched off until Bright Data has signed a data processing agreement with us as our processor."}
      </p>
      {reddit?.mode === "collect" ? (
        <p>
          We keep only the posts that match a customer&apos;s product, with a link back to Reddit,
          and delete them from AskedFor after {reddit.retentionDays} days.
        </p>
      ) : null}
      <p>
        {snapshotRetention
          ? `Bright Data keeps the snapshots it delivers to us for ${snapshotRetention}.`
          : "How long Bright Data keeps the snapshots it delivers to us is being confirmed with Bright Data, and is stated here before any Reddit post is collected."}
      </p>
    </section>
  );
}
