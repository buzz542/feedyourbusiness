import type { Metadata } from "next";
import { DataProviderNotice } from "../_components/data-provider-notice";
import { LegalPlaceholder } from "../_components/legal-placeholder";

export const metadata: Metadata = { title: "Privacy notice" };

export default function Page() {
  return (
    <LegalPlaceholder title="Privacy notice">
      <DataProviderNotice />
    </LegalPlaceholder>
  );
}
