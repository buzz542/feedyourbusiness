"use client";

import { FeedError } from "@/components/app/feed-error";

/** A server error on any app page without its own (Product, Settings): retry() fetches it again. */
export default function TabsError({ retry }: { error: Error; retry: () => void }) {
  return <FeedError retry={retry} />;
}
