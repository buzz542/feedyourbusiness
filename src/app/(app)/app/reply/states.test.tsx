import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirstRunBanner } from "@/components/app/reply/first-run-banner";
import Loading from "./loading";

/** Loading and progress states for the Reply tab (docs/PLAN.md 4.9). */
describe("Reply states", () => {
  it("loading shows skeleton cards with one status message", () => {
    const html = renderToStaticMarkup(<Loading />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading posts");
    expect(html.match(/<li/g)).toHaveLength(4);
  });

  it("the first-run banner shows progress by source, politely announced", () => {
    const html = renderToStaticMarkup(
      <FirstRunBanner
        status={{
          sources: [
            { source: "hackernews", status: "done" },
            { source: "reddit", status: "running" },
            { source: "bluesky", status: "failed" },
          ],
          finished: false,
        }}
      />,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Hacker News: done");
    expect(html).toContain("Reddit: collecting");
    expect(html).toContain("Bluesky: did not finish");
  });
});
