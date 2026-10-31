import { describe, expect, it } from "vitest";
import { checkSources } from "./sources";

/** /api/health `sources` (docs/PLAN.md 7.7, M3): what is on, what is missing, never a value. */

const NOW = new Date("2026-10-31T12:00:00Z");
const PROD = { VERCEL_ENV: "production" };

describe("checkSources", () => {
  it("is ok with every collect source off, the default", () => {
    expect(checkSources(PROD, NOW)).toEqual({ status: "ok", detail: "no collect source is on" });
  });

  it("lists the sources that are on and ready", () => {
    expect(checkSources({ ...PROD, SOURCE_HACKERNEWS_ENABLED: "true" }, NOW)).toEqual({
      status: "ok",
      detail: "on: hackernews",
    });
  });

  it("names missing credentials, never their values", () => {
    const env = {
      ...PROD,
      SOURCE_BLUESKY_ENABLED: "true",
      BLUESKY_IDENTIFIER: "askedfor-bot.example.test",
    };
    const result = checkSources(env, NOW);
    expect(result.status).toBe("invalid");
    expect(result.detail).toContain("bluesky missing BLUESKY_APP_PASSWORD");
    expect(result.detail).not.toContain("askedfor-bot");
  });

  it("reports Reddit held back in production until the DPA date is set (2.1.7)", () => {
    const env = {
      ...PROD,
      SOURCE_REDDIT_ENABLED: "true",
      BRIGHTDATA_API_TOKEN: "secret-token-value",
      BRIGHTDATA_REDDIT_DATASET_ID: "gd_lvz8ah06191smkebj4",
      REDDIT_PROVIDER: "brightdata",
    };
    const held = checkSources(env, NOW);
    expect(held.status).toBe("invalid");
    expect(held.detail).toContain("reddit held: BRIGHTDATA_DPA_SIGNED_ON");
    expect(held.detail).not.toContain("secret-token-value");
    // With the date set, it is still held until the module states the snapshot retention.
    const dated = checkSources({ ...env, BRIGHTDATA_DPA_SIGNED_ON: "2026-10-30" }, NOW);
    expect(dated.detail).toContain("reddit held: snapshot retention not stated");
  });

  it("reports a source's own configuration problems", () => {
    const result = checkSources(
      {
        ...PROD,
        SOURCE_REDDIT_ENABLED: "true",
        BRIGHTDATA_DPA_SIGNED_ON: "2026-10-30",
        BRIGHTDATA_API_TOKEN: "token-value",
        REDDIT_PROVIDER: "brightdata",
        BRIGHTDATA_REDDIT_DATASET_ID: "gd_linkedin_people",
      },
      NOW,
    );
    expect(result.status).toBe("invalid");
    expect(result.detail).toMatch(/reddit: .*BRIGHTDATA_REDDIT_DATASET_ID/);
    expect(result.detail).not.toContain("gd_linkedin_people");
  });
});
