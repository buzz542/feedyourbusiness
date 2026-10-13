import type { Metadata } from "next";
import { LegalPlaceholder } from "../_components/legal-placeholder";

export const metadata: Metadata = { title: "Acceptable use" };

export default function Page() {
  return <LegalPlaceholder title="Acceptable use" />;
}
