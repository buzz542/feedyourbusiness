import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAppUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Reply" };
export const dynamic = "force-dynamic";

export default async function ReplyPage() {
  // Layouts do not re-run on client navigation, so each page checks for itself.
  await requireAppUser("/app/reply");
  return (
    <EmptyState title="No posts yet">
      Posts worth replying to show up here once your product is set up and the first collection has
      run.
    </EmptyState>
  );
}
