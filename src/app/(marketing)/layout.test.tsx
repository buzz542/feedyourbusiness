import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The site navigation (the founder's brief, 27 Nov 2026; compliance review of the homepage). */
describe("the site navigation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends Start your trial to pricing, where the full terms sit beside the action", async () => {
    vi.stubEnv("LAUNCH_OPEN", "true");
    const { default: Layout } = await import("./layout");
    const html = renderToStaticMarkup(<Layout>{null}</Layout>);
    const nav = /<nav aria-label="Site"[\s\S]*?<\/nav>/.exec(html)![0];
    expect(nav).toMatch(/<a[^>]*href="\/pricing"[^>]*>Start your trial<\/a>/);
    expect(nav).not.toContain('href="/login?next=%2Fapp"');
  });

  it("shows no trial button while sign-up is closed", async () => {
    vi.stubEnv("LAUNCH_OPEN", "");
    const { default: Layout } = await import("./layout");
    expect(renderToStaticMarkup(<Layout>{null}</Layout>)).not.toContain("Start your trial");
  });
});
