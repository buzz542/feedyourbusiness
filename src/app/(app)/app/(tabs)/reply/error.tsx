"use client";

import { FeedError } from "@/components/app/feed-error";

export default function ReplyError({ reset }: { error: Error; reset: () => void }) {
  return <FeedError retry={reset} />;
}
