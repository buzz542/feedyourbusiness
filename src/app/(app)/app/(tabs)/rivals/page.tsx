import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAppUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Rivals" };
export const dynamic = "force-dynamic";

export default async function RivalsPage() {
  // Layouts do not re-run on client navigation, so each page checks for itself.
  await requireAppUser("/app/rivals");
  return (
    <EmptyState title="Nothing on your rivals yet">
      What your competitors get wrong, and who wants to switch, shows up here once posts start
      coming in.
    </EmptyState>
  );
}
