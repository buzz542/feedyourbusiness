import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePage } from "@/server/auth/app-state";

export const metadata: Metadata = { title: "Rivals" };

export default async function RivalsPage() {
  await requirePage("rivals", "/app/rivals");
  return (
    <div>
      <h1 className="sr-only">Rivals</h1>
      <EmptyState
        title="Nothing here yet"
        body="What your competitors get wrong appears here after your first weekly report."
      />
    </div>
  );
}
