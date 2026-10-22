import type { Metadata } from "next";
import { requireAppPage } from "@/server/auth/account";
import { ComingSoon } from "../_components/coming-soon";

export const metadata: Metadata = { title: "Start your trial" };

export default async function Page() {
  await requireAppPage("/app/billing");
  return <ComingSoon title="Start your trial" />;
}
