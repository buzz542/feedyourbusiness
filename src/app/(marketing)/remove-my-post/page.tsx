import type { Metadata } from "next";
import { LegalPlaceholder } from "../_components/legal-placeholder";

export const metadata: Metadata = { title: "Remove my post" };

export default function Page() {
  return (
    <LegalPlaceholder title="Remove my post">
      <p className="mt-4">The removal form is not live yet.</p>
    </LegalPlaceholder>
  );
}
