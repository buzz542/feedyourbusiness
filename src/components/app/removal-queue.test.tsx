import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RemovalQueue } from "./removal-queue";

/** The admin removal queue (docs/PLAN.md 4.8). */

const act = async () => ({ message: "ok" });
const item = {
  id: "r1",
  source: "reddit",
  linkOrHandle: "https://www.reddit.com/r/SaaS/comments/1abc23/x/",
  contactEmail: "person@example.test",
  details: null,
  dueAt: "2026-12-05T12:00:00.000Z",
  targetAt: "2026-11-08T12:00:00.000Z",
};

describe("RemovalQueue", () => {
  it("shows each request with its due date, its link as text, and the one-click action", () => {
    const html = renderToStaticMarkup(
      <RemovalQueue
        items={[item]}
        now="2026-11-09T00:00:00.000Z"
        deleteAndSuppress={act}
        closeWithoutMatch={act}
      />,
    );
    expect(html).toContain("due 2026-12-05 12:00 UTC");
    expect(html).toContain("past the 72-hour target");
    expect(html).toContain(item.linkOrHandle);
    expect(html).not.toContain(`href="${item.linkOrHandle}"`);
    expect(html).toContain("Delete and suppress");
  });

  it("says so when nothing is open", () => {
    const html = renderToStaticMarkup(
      <RemovalQueue items={[]} now="x" deleteAndSuppress={act} closeWithoutMatch={act} />,
    );
    expect(html).toContain("No open removal requests.");
  });
});
