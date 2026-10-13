import type { Metadata } from "next";
import { LegalPlaceholder } from "../_components/legal-placeholder";

export const metadata: Metadata = { title: "Cookies" };

export default function Page() {
  return <LegalPlaceholder title="Cookies" />;
}
