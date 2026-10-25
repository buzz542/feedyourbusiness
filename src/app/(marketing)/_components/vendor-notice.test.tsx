import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sources } from "@/sources/registry";
import PrivacyPage from "../privacy/page";
import SourcesPage from "../sources/page";
import { SiteFooter } from "./site-footer";
import { VendorNotice } from "./vendor-notice";

/**
 * docs/PLAN.md 2.1.7 and 9.6: the privacy notice and the sources page name the data provider, say
 * it collects public Reddit pages logged out, that this is not a data license from Reddit, and how
 * long it keeps snapshots. M3 ships a minimal version of both.
 */

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");

describe("the data provider notice", () => {
  const pages = {
    privacy: text(renderToStaticMarkup(<PrivacyPage />)),
    sources: text(renderToStaticMarkup(<SourcesPage />)),
  };

  it.each(Object.entries(pages))("appears on the %s page", (_name, page) => {
    expect(page).toContain("Bright Data");
    expect(page).toContain("collects public Reddit pages for us, logged out");
    expect(page).toContain("This is not a data license from Reddit");
    expect(page).toMatch(/How long Bright Data keeps .* snapshots/);
    expect(page).not.toMatch(/official APIs only|don't scrape|no scraping/i);
  });
});

describe("the data provider notice before and after the DPA", () => {
  const notice = (props: Parameters<typeof VendorNotice>[0]) =>
    text(renderToStaticMarkup(<VendorNotice {...props} />));
  const UNDER_DPA = "Bright Data works for us as a processor under a data processing agreement";

  it("says Reddit stays off, not that a DPA exists, until the DPA date is set", () => {
    const page = notice({ dpaSignedOn: null, snapshotRetention: null });
    expect(page).not.toContain(UNDER_DPA);
    expect(page).toContain(
      "Reddit collection stays switched off until Bright Data has signed a data processing agreement with us",
    );
  });

  it("states the DPA once its date is set", () => {
    expect(notice({ dpaSignedOn: "2026-10-02", snapshotRetention: null })).toContain(UNDER_DPA);
  });

  it("states the snapshot retention once it is confirmed", () => {
    const page = notice({ dpaSignedOn: "2026-10-02", snapshotRetention: "30 days" });
    expect(page).toContain("Bright Data keeps the snapshots it delivers to us for 30 days");
    expect(page).not.toContain("being confirmed");
  });

  it("is in the DPA-pending state on these pages, where no DPA date is set", () => {
    for (const page of [
      renderToStaticMarkup(<PrivacyPage />),
      renderToStaticMarkup(<SourcesPage />),
    ])
      expect(text(page)).not.toContain(UNDER_DPA);
  });
});

describe("Bluesky links (docs/PLAN.md 7.5)", () => {
  it.each([
    ["privacy", PrivacyPage],
    ["sources", SourcesPage],
  ])("the %s page says a link carries the author's DID", (_name, Page) => {
    const page = text(renderToStaticMarkup(<Page />));
    expect(page).toMatch(/Bluesky.*DID/);
    expect(page).toContain("a permanent public id for the author's account");
  });
});

describe("the sources page", () => {
  const page = text(renderToStaticMarkup(<SourcesPage />));

  it("lists every collect source in the registry with how it is reached and its retention", () => {
    for (const source of sources) {
      if (source.mode !== "collect") continue;
      expect(page).toContain(source.displayName);
      expect(page).toContain(`Deleted from AskedFor after ${source.retentionDays} days`);
      expect(page).toContain(
        source.access === "vendor_api"
          ? `Through a data provider: ${source.vendor!.name}`
          : "Through its official API",
      );
    }
  });

  it("lists exactly the registry's collect sources, no more", () => {
    const html = renderToStaticMarkup(<SourcesPage />);
    const listed = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]);
    expect(listed).toEqual(sources.filter((s) => s.mode === "collect").map((s) => s.displayName));
  });

  it("lists the search-link platforms as searches the user opens", () => {
    for (const source of sources)
      if (source.mode === "link") expect(page).toContain(source.displayName);
    expect(page).toMatch(/searches you open yourself/i);
  });

  it("never names a collected platform in the sentence that says nothing is collected", () => {
    const sentence = /AskedFor collects nothing\.[^.]*\./.exec(page)?.[0] ?? "";
    expect(sentence).toContain("LinkedIn");
    for (const source of sources)
      if (source.mode === "collect") expect(sentence).not.toContain(source.displayName);
    expect(page).toContain("You also get search links for Reddit and X");
  });

  it("says AskedFor never acts on a platform or writes replies", () => {
    expect(page).toContain("We never post, reply, vote or message on any platform");
    expect(page).toContain("we never write your replies");
  });

  it("is linked from every page's footer", () => {
    expect(renderToStaticMarkup(<SiteFooter />)).toContain('href="/sources"');
  });
});
