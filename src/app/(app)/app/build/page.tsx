import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePage } from "@/server/auth/app-state";

export const metadata: Metadata = { title: "Build" };

export default async function BuildPage() {
  await requirePage("build", "/app/build");
  return (
    <div>
      <h1 className="sr-only">Build</h1>
      <EmptyState
        title="Nothing here yet"
        body="Patterns in what people ask for appear here after your first weekly report."
      />
    </div>
  );
}
