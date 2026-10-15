import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePage } from "@/server/auth/app-state";

export const metadata: Metadata = { title: "Reply" };

export default async function ReplyPage() {
  await requirePage("reply", "/app/reply");
  return (
    <div>
      <h1 className="sr-only">Reply</h1>
      <EmptyState
        title="Nothing here yet"
        body="Public posts worth replying to appear here after your first run."
      />
    </div>
  );
}
