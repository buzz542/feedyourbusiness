import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAppUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Build" };
export const dynamic = "force-dynamic";

export default async function BuildPage() {
  // Layouts do not re-run on client navigation, so each page checks for itself.
  await requireAppUser("/app/build");
  return (
    <EmptyState title="No themes yet">
      The patterns in what people ask for show up here each week once posts start coming in.
    </EmptyState>
  );
}
