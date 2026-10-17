import { describe, expect, it } from "vitest";
import { createLlm } from "@/server/llm/llm";
import { OwnSiteError } from "@/server/net/own-site-error";
import { draftFromUrl, type DraftStore } from "@/server/onboarding/draft";
import { createFakeDraftDeps, fakeServicesEnabled } from "./fake-services";

/** E2E fake services (docs/TASKS.md M2): only on a local dev server, never on any deployment. */

const LOCAL = {
  E2E_FAKE_SERVICES: "1",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NODE_ENV: "development",
};

describe("fakeServicesEnabled", () => {
  it.each([
    ["localhost", LOCAL],
    ["127.0.0.1", { ...LOCAL, NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100" }],
  ])("is honored on %s with VERCEL_ENV unset", (_label, env) => {
    expect(fakeServicesEnabled(env)).toBe(true);
  });

  it.each([
    ["the flag unset", { ...LOCAL, E2E_FAKE_SERVICES: undefined }],
    ["the flag not exactly 1", { ...LOCAL, E2E_FAKE_SERVICES: "true" }],
    ["a production deployment", { ...LOCAL, VERCEL_ENV: "production" }],
    ["a preview deployment", { ...LOCAL, VERCEL_ENV: "preview" }],
    ["vercel dev", { ...LOCAL, VERCEL_ENV: "development" }],
    ["a production build (next start)", { ...LOCAL, NODE_ENV: "production" }],
    ["NODE_ENV unset", { ...LOCAL, NODE_ENV: undefined }],
    ["the real site URL", { ...LOCAL, NEXT_PUBLIC_SITE_URL: "https://askedfor.app" }],
    ["a lookalike host", { ...LOCAL, NEXT_PUBLIC_SITE_URL: "http://localhost.askedfor.app" }],
    ["no site URL", { E2E_FAKE_SERVICES: "1", NODE_ENV: "development" }],
    ["a site URL that is not a URL", { ...LOCAL, NEXT_PUBLIC_SITE_URL: "localhost" }],
  ])("is refused with %s", (_label, env) => {
    expect(fakeServicesEnabled(env)).toBe(false);
  });
});

describe("createFakeDraftDeps", () => {
  const store = (): DraftStore => ({
    ensureDraftProduct: async () => ({ productId: "p1" }),
    saveDraft: async () => {},
  });

  it("drafts without any network access or model key", async () => {
    const result = await draftFromUrl("https://invoicer.example/", createFakeDraftDeps(store()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.terms.length).toBeGreaterThanOrEqual(20);
      expect(result.draft.subreddits).not.toContain("depression");
    }
  });

  it("can play an unreachable site, for the description fallback", async () => {
    const deps = createFakeDraftDeps(store());
    await expect(deps.fetchSite("https://unreachable.example/")).rejects.toBeInstanceOf(
      OwnSiteError,
    );
  });

  it("uses the real model wrapper, so validation and caps still run", () => {
    expect(Object.keys(createFakeDraftDeps(store()).llm)).toEqual(
      Object.keys(createLlm({} as never)),
    );
  });
});
