import { describe, expect, it } from "vitest";
import { createOnboarding } from "./service";
import { FakeOnboardingStore } from "./fakes";
import { fakeOnboardingServices, fakeServicesEnabled } from "./e2e-services";

/**
 * E2E_FAKE_SERVICES (docs/TASKS.md M2): a fixture page and a canned model for the localhost E2E,
 * honored only on a developer's own dev server, never on Vercel or any deployed site.
 */

const LOCAL = {
  E2E_FAKE_SERVICES: "1",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3210",
  NODE_ENV: "development",
};

describe("fakeServicesEnabled", () => {
  it("is on for a local dev server that asks for it", () => {
    expect(fakeServicesEnabled(LOCAL)).toBe(true);
  });

  it.each([
    ["the flag is unset", { ...LOCAL, E2E_FAKE_SERVICES: undefined }],
    ["the flag is not exactly 1", { ...LOCAL, E2E_FAKE_SERVICES: "true" }],
    ["on any Vercel environment", { ...LOCAL, VERCEL_ENV: "preview" }],
    ["in production on Vercel", { ...LOCAL, VERCEL_ENV: "production" }],
    ["the site is not localhost", { ...LOCAL, NEXT_PUBLIC_SITE_URL: "https://askedfor.app" }],
    ["the site URL is missing", { ...LOCAL, NEXT_PUBLIC_SITE_URL: undefined }],
    ["a production build", { ...LOCAL, NODE_ENV: "production" }],
  ])("is refused when %s", (_label, env) => {
    expect(fakeServicesEnabled(env)).toBe(false);
  });
});

describe("the fake services", () => {
  it("draft a product from the fixture page with the canned model", async () => {
    const store = new FakeOnboardingStore();
    const onboarding = createOnboarding({ store, ...fakeOnboardingServices() });
    const outcome = await onboarding.draftFromUrl("user-1", "https://e2e-product.example/");
    expect(outcome.kind).toBe("saved");
    const product = store.ownedBy("user-1")!;
    expect(product.terms.length).toBeGreaterThanOrEqual(20);
    expect(product.competitors.length).toBeGreaterThan(0);
  });

  it("still refuse a platform URL, as the real fetch does", async () => {
    const onboarding = createOnboarding({
      store: new FakeOnboardingStore(),
      ...fakeOnboardingServices(),
    });
    expect(await onboarding.draftFromUrl("user-1", "https://www.reddit.com/r/x")).toEqual({
      kind: "needs_description",
      reason: "platform_page",
    });
  });
});
