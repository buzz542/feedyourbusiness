import { describe, expect, it } from "vitest";
import { fakeServicesAllowed } from "./fake-services";

/** E2E_FAKE_SERVICES (docs/TASKS.md M2): honored only on a local run against localhost. */
describe("fakeServicesAllowed", () => {
  const local = { E2E_FAKE_SERVICES: "1", NEXT_PUBLIC_SITE_URL: "http://localhost:3210" };

  it("is on for a local run against localhost", () => {
    expect(fakeServicesAllowed(local)).toBe(true);
    expect(fakeServicesAllowed({ ...local, NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000" })).toBe(
      true,
    );
  });

  it.each([
    ["not asked for", { ...local, E2E_FAKE_SERVICES: undefined }],
    ["asked for loosely", { ...local, E2E_FAKE_SERVICES: "true" }],
    ["on Vercel production", { ...local, VERCEL_ENV: "production" }],
    ["on a Vercel preview", { ...local, VERCEL_ENV: "preview" }],
    ["on Vercel development", { ...local, VERCEL_ENV: "development" }],
    ["against a real site URL", { ...local, NEXT_PUBLIC_SITE_URL: "https://askedfor.app" }],
    ["against a lookalike", { ...local, NEXT_PUBLIC_SITE_URL: "http://localhost.evil.example" }],
    ["with no site URL", { E2E_FAKE_SERVICES: "1" }],
  ])("is refused when %s", (_, env) => {
    expect(fakeServicesAllowed(env)).toBe(false);
  });
});
