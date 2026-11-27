import { describe, expect, it } from "vitest";
import { sourceProblems, type CollectJobRow } from "./source-health";

/**
 * Which sources failed in their last run for a product (the founder's brief: integration errors
 * get their own state, never hidden behind "no conversations"). Only the latest run of each
 * enabled source counts.
 */

const row = (over: Partial<CollectJobRow>): CollectJobRow => ({
  source: "hackernews",
  status: "done",
  result: "ok",
  updatedAt: "2026-11-27T06:05:00Z",
  ...over,
});

describe("sourceProblems", () => {
  it("names a source whose last run failed, timed out or could not start", () => {
    expect(
      sourceProblems(
        [
          row({ source: "hackernews", result: "source_failed" }),
          row({ source: "bluesky", status: "failed", result: null }),
          row({ source: "reddit", result: "timeout" }),
        ],
        ["hackernews", "bluesky", "reddit"],
      ),
    ).toEqual(["hackernews", "bluesky", "reddit"]);
    expect(sourceProblems([row({ result: "not_ready" })], ["hackernews"])).toEqual(["hackernews"]);
    expect(sourceProblems([row({ result: "interrupted" })], ["hackernews"])).toEqual([
      "hackernews",
    ]);
  });

  it("looks only at each source's latest run, so a recovery clears it", () => {
    expect(
      sourceProblems(
        [
          row({ result: "source_failed", updatedAt: "2026-11-26T06:05:00Z" }),
          row({ result: "ok", updatedAt: "2026-11-27T06:05:00Z" }),
        ],
        ["hackernews"],
      ),
    ).toEqual([]);
  });

  it("never counts a run still going, a budget stop, a switched-off source or one not enabled", () => {
    expect(
      sourceProblems(
        [
          row({ source: "hackernews", status: "waiting", result: null }),
          row({ source: "bluesky", result: "budget" }),
          row({ source: "reddit", result: "source_off" }),
          row({ source: "x", result: "source_failed" }),
        ],
        ["hackernews", "bluesky", "reddit"],
      ),
    ).toEqual([]);
  });
});
