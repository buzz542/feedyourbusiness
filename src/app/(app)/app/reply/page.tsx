import type { Metadata } from "next";
import { requireAppPage } from "@/server/auth/account";
import { ComingSoon } from "../_components/coming-soon";

export const metadata: Metadata = { title: "Reply" };

export default async function Page() {
  await requireAppPage("/app/reply");
  return <ComingSoon title="Reply" />;
}
