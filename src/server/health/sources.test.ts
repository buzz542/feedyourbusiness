import { describe, expect, it } from "vitest";
import { checkSources } from "./sources";

/** /api/health `sources` (docs/PLAN.md 7.7, M3): what is on, what is missing, never a value. */

const PROD = { VERCEL_ENV: "production" };

describe("checkSources", () => {
  it("is ok with every collect source off, the default", () => {
    expect(checkSources(PROD)).toEqual({ status: "ok", detail: "no collect source is on" });
  });

  it("lists the sources that are on and ready", () => {
    expect(checkSources({ ...PROD, SOURCE_HACKERNEWS_ENABLED: "true" })).toEqual({
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
    const result = checkSources(env);
    expect(result.status).toBe("invalid");
    expect(result.detail).toContain("bluesky missing BLUESKY_APP_PASSWORD");
    expect(result.detail).not.toContain("askedfor-bot");
  });

  it("reports Reddit on in production once its switch is on, with no secret in the detail", () => {
    const env = {
      ...PROD,
      SOURCE_REDDIT_ENABLED: "true",
      BRIGHTDATA_API_TOKEN: "secret-token-value",
      BRIGHTDATA_REDDIT_DATASET_ID: "gd_lvz8ah06191smkebj4",
      REDDIT_PROVIDER: "brightdata",
    };
    const on = checkSources(env);
    expect(on.detail).toContain("reddit");
    expect(on.detail).not.toContain("secret-token-value");
    expect(on.detail).not.toContain("held");
  });

  it("reports a source's own configuration problems", () => {
    const result = checkSources({
      ...PROD,
      SOURCE_REDDIT_ENABLED: "true",
      BRIGHTDATA_DPA_SIGNED_ON: "2026-10-30",
      BRIGHTDATA_API_TOKEN: "token-value",
      REDDIT_PROVIDER: "brightdata",
      BRIGHTDATA_REDDIT_DATASET_ID: "gd_linkedin_people",
    });
    expect(result.status).toBe("invalid");
    expect(result.detail).toMatch(/reddit: .*BRIGHTDATA_REDDIT_DATASET_ID/);
    expect(result.detail).not.toContain("gd_linkedin_people");
  });
});
