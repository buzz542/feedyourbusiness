import type { Metadata } from "next";
import { ComingSoon } from "../_components/coming-soon";

export const metadata: Metadata = { title: "Build" };

export default function Page() {
  return <ComingSoon title="Build" />;
}
