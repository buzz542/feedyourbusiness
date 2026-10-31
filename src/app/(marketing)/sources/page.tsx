import type { Metadata } from "next";
import { DataProviderNotice } from "../_components/data-provider-notice";
import { LegalPlaceholder } from "../_components/legal-placeholder";

export const metadata: Metadata = { title: "Where posts come from" };

/** The minimal sources page (docs/PLAN.md M3); the full list of sources arrives with M9. */
export default function Page() {
  return (
    <LegalPlaceholder title="Where posts come from">
      <DataProviderNotice />
    </LegalPlaceholder>
  );
}
