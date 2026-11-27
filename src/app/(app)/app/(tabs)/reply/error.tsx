"use client";

import { FeedError } from "@/components/app/feed-error";

/**
 * A server error while the Reply view loads. retry() fetches the page again (Next 16); reset()
 * would only re-render what failed, so a server error could never recover.
 */
export default function ReplyError({ retry }: { error: Error; retry: () => void }) {
  return <FeedError retry={retry} />;
}
