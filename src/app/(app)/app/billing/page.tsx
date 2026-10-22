import type { Metadata } from "next";
import { ComingSoon } from "../_components/coming-soon";

export const metadata: Metadata = { title: "Start your trial" };

export default function Page() {
  return <ComingSoon title="Start your trial" />;
}
