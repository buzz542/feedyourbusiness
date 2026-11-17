"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  countsAfterMove,
  type CountedPost,
  type PostState,
  type ViewCounts,
} from "@/lib/feed-views";

interface FeedCounts {
  /** Null before there is a product to count. */
  counts: ViewCounts | null;
  /** A card moved a post from one state to another and the server said yes. */
  moved(post: Omit<CountedPost, "state">, from: PostState, to: PostState): void;
}

const Context = createContext<FeedCounts>({ counts: null, moved: () => undefined });

/**
 * The side panel's counts. The layout loads them once; it does not render again on navigation, so
 * each change a card makes is applied here (src/lib/feed-views.ts) and the counts stay right. A new
 * load from the server, after a reload, replaces them.
 */
export function FeedCountsProvider({
  initial,
  threshold,
  children,
}: {
  initial: ViewCounts | null;
  threshold: number | null;
  children: ReactNode;
}) {
  const [loaded, setLoaded] = useState(initial);
  const [counts, setCounts] = useState(initial);
  if (initial !== loaded) {
    setLoaded(initial);
    setCounts(initial);
  }
  const moved = useCallback<FeedCounts["moved"]>(
    (post, from, to) => {
      if (threshold === null) return;
      setCounts((c) => c && countsAfterMove(c, post, from, to, new Date(), threshold));
    },
    [threshold],
  );
  const value = useMemo(() => ({ counts, moved }), [counts, moved]);
  return <Context value={value}>{children}</Context>;
}

export const useFeedCounts = (): FeedCounts => useContext(Context);
