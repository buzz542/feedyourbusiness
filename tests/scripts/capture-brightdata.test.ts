import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  captureBrightdataFixture,
  type CaptureDeps,
} from "../../scripts/capture-brightdata-fixture";

/** The founder's capture (F8), run here against fakes: counts and field names only, then deleted. */

const fixture = (name: string) => readFileSync(`tests/fixtures/reddit/${name}`, "utf8");
const ENV = {
  BRIGHTDATA_API_TOKEN: "test-token",
  BRIGHTDATA_REDDIT_DATASET_ID: "gd_lvz8ah06191smkebj4",
};

function deps(snapshot: string, env: CaptureDeps["env"] = ENV) {
  const files = new Map<string, string>();
  const lines: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes("/trigger?")) return new Response(fixture("trigger.json"));
    if (url.includes("/progress/")) return new Response(fixture("progress-ready.json"));
    if (url.includes("/snapshot/")) return new Response(snapshot);
    throw new Error(`unrouted ${url}`);
  });
  const d: CaptureDeps = {
    env,
    fetchImpl,
    now: () => new Date("2026-10-17T09:00:00Z"),
    sleep: async () => {},
    writeFile: vi.fn((path: string, text: string) => void files.set(path, text)),
    removeFile: vi.fn((path: string) => void files.delete(path)),
    log: (line) => lines.push(line),
  };
  return { d, files, lines, fetchImpl };
}

describe("capture-brightdata-fixture", () => {
  it("passes on the documented shape, printing counts and field names but no value", async () => {
    const { d, files, lines, fetchImpl } = deps(fixture("snapshot.json"));
    expect(await captureBrightdataFixture(d)).toBe(true);
    const output = lines.join("\n");
    expect(output).toMatch(/^PASS$/m);
    expect(output).toContain("Records: 15 (1 error records)");
    expect(output).toMatch(/Field names: .*post_id.*user_posted/);
    expect(output).toContain("NSFW fields present: over_18");
    // No value from any record: no username, no text, no link.
    expect(output).not.toMatch(/example_|invoice|reddit\.com|\[deleted\]/i);
    // Written under fixtures-local/ and deleted again.
    expect(d.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/^fixtures-local\/brightdata-reddit-\d+\.json$/),
      expect.any(String),
    );
    expect(files.size).toBe(0);
    // One small query: 1 term, 5 posts.
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(body).toEqual([
      expect.objectContaining({ keyword: "invoice software", num_of_posts: 5 }),
    ]);
  });

  it("fails, and still deletes the capture, when no NSFW field comes back", async () => {
    const records = (JSON.parse(fixture("snapshot.json")) as Record<string, unknown>[]).map(
      ({ over_18: _drop, ...rest }) => rest,
    );
    const { d, files, lines } = deps(JSON.stringify(records));
    expect(await captureBrightdataFixture(d)).toBe(false);
    expect(lines.join("\n")).toMatch(/FAIL: no known NSFW field/);
    expect(files.size).toBe(0);
  });

  it("still prints the field names, and no value, when the schema matches no record", async () => {
    const records = (JSON.parse(fixture("snapshot.json")) as Record<string, unknown>[]).map(
      ({ date_posted: _drop, ...rest }) => rest,
    );
    const { d, files, lines } = deps(JSON.stringify(records));
    expect(await captureBrightdataFixture(d)).toBe(false);
    const output = lines.join("\n");
    expect(output).toMatch(/Field names: .*post_id.*user_posted/);
    expect(output).toContain("Mapped fields missing: date_posted");
    expect(output).toMatch(/FAIL: the run failed with InvalidResponse/);
    expect(output).not.toMatch(/example_|invoice|reddit\.com|\[deleted\]/i);
    expect(files.size).toBe(0);
  });

  it("says whether a community type field came back, and asks for confirmation when none did", async () => {
    const { d, lines } = deps(fixture("snapshot.json"));
    await captureBrightdataFixture(d);
    expect(lines.join("\n")).toContain("Community type fields present: none");
    expect(lines.join("\n")).toMatch(/NOTE: .*private or quarantined communities/);
    const typed = (JSON.parse(fixture("snapshot.json")) as Record<string, unknown>[]).map((r) =>
      "error" in r ? r : { ...r, community_type: "public" },
    );
    const second = deps(JSON.stringify(typed));
    await captureBrightdataFixture(second.d);
    expect(second.lines.join("\n")).toContain("Community type fields present: community_type");
  });

  it("never prints a nested key that only one record has, which could be a value", async () => {
    const records = JSON.parse(fixture("snapshot.json")) as Record<string, unknown>[];
    records[0] = { ...records[0], mentions: { someone_real_42: 1 } };
    const { d, lines } = deps(JSON.stringify(records));
    await captureBrightdataFixture(d);
    const output = lines.join("\n");
    expect(output).not.toContain("someone_real_42");
    expect(output).toContain("mentions");
  });

  it("fails without calling anything when the token is missing", async () => {
    const { d, lines, fetchImpl } = deps("[]", {
      BRIGHTDATA_REDDIT_DATASET_ID: ENV.BRIGHTDATA_REDDIT_DATASET_ID,
    });
    expect(await captureBrightdataFixture(d)).toBe(false);
    expect(lines.join("\n")).toContain("FAIL: the run failed with MissingCredentials.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
