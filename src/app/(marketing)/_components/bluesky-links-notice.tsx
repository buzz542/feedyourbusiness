/**
 * docs/PLAN.md 7.5: Bluesky links name the author's DID, never the handle, and the privacy notice
 * says so. On the privacy notice and the sources page alike.
 */
export function BlueskyLinksNotice() {
  return (
    <p>
      Links to Bluesky posts use the author&apos;s DID, a permanent public id for the author&apos;s
      account that Bluesky turns into their handle, rather than the handle itself.
    </p>
  );
}
