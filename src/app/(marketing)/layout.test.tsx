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

  it("spells the name out in the middle, between the logo and the links, so FYB reads as the logo", async () => {
    const { default: Layout } = await import("./layout");
    const nav = /<nav aria-label="Site"[\s\S]*?<\/nav>/.exec(
      renderToStaticMarkup(<Layout>{null}</Layout>),
    )![0];
    const logo = nav.indexOf('aria-label="FeedYourBusiness, home"');
    const visible = /<span[^>]*aria-hidden="true"[^>]*>FeedYourBusiness<\/span>/.exec(nav);
    const links = nav.indexOf("How it works");
    expect(logo).toBeGreaterThan(-1);
    expect(visible).not.toBeNull();
    // The name is its own text, after the logo link and before the links, centered in the gap.
    expect(visible!.index).toBeGreaterThan(logo);
    expect(visible!.index).toBeLessThan(links);
    const span = visible![0];
    expect(span).toContain("flex-1");
    expect(span).toContain("text-center");
    // The logo link already names us for assistive technology, so the visible name is not read twice.
    expect(span).toContain('aria-hidden="true"');
  });

  it("shows no trial button while sign-up is closed", async () => {
    vi.stubEnv("LAUNCH_OPEN", "");
    const { default: Layout } = await import("./layout");
    expect(renderToStaticMarkup(<Layout>{null}</Layout>)).not.toContain("Start your trial");
  });

  it("keeps a page's own width: its content sits in one readable column", async () => {
    const { default: Layout } = await import("./layout");
    const html = renderToStaticMarkup(
      <Layout>
        <form className="max-w-sm">x</form>
      </Layout>,
    );
    expect(html).toMatch(/<div class="[^"]*max-w-3xl[^"]*"><form class="max-w-sm">/);
    expect(html).not.toContain("not([data-wide])");
  });
});

describe("the skip link", () => {
  it("sits above the sticky navigation when it has focus", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/layout.tsx", "utf8")).toMatch(/Skip to content/);
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("focus:z-50");
  });
});
