import type { Metadata } from "next";
import { requireAppPage } from "@/server/auth/account";
import { ComingSoon } from "../_components/coming-soon";

export const metadata: Metadata = { title: "Settings" };

export default async function Page() {
  await requireAppPage("/app/settings");
  return <ComingSoon title="Settings" />;
}
