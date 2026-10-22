import type { Metadata } from "next";
import { requireAppPage } from "@/server/auth/account";
import { ComingSoon } from "../_components/coming-soon";

export const metadata: Metadata = { title: "Build" };

export default async function Page() {
  await requireAppPage("/app/build");
  return <ComingSoon title="Build" />;
}
