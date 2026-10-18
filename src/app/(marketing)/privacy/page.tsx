import type { Metadata } from "next";
import { BlueskyLinksNotice } from "../_components/bluesky-links-notice";
import { LegalPlaceholder } from "../_components/legal-placeholder";
import { VendorNotice } from "../_components/vendor-notice";

export const metadata: Metadata = { title: "Privacy notice" };

export default function Page() {
  return (
    <LegalPlaceholder title="Privacy notice">
      <VendorNotice />
      <section aria-labelledby="bluesky-links" className="mt-10 space-y-3">
        <h2 id="bluesky-links" className="font-serif text-xl tracking-tight">
          Links to Bluesky posts
        </h2>
        <BlueskyLinksNotice />
      </section>
    </LegalPlaceholder>
  );
}
