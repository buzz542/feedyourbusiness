import { describe, expect, it } from "vitest";
import { classifyInput } from "./input";

/**
 * Onboarding input (docs/PLAN.md 4.3 step 2, 8.3 step 1): one box takes the user's own website or a
 * description. Platforms, store and repo pages, email addresses and handles are refused before
 * anything is fetched.
 */

describe("classifyInput: links", () => {
  it.each([
    ["a site URL", "https://acme.example/", "https://acme.example/"],
    [
      "a deep link",
      "https://acme.example/product/invoices",
      "https://acme.example/product/invoices",
    ],
    ["a bare domain", "acme.example", "https://acme.example/"],
    ["a bare domain with a path", "www.acme.example/pricing", "https://www.acme.example/pricing"],
    ["an http link, upgraded once", "http://acme.example/", "https://acme.example/"],
    ["surrounding spaces", "  https://acme.example  ", "https://acme.example/"],
    [
      "tracking parameters, dropped",
      "https://acme.example/?utm_source=x&ref=y#top",
      "https://acme.example/",
    ],
    ["a GitHub Pages site", "https://acme.github.io/", "https://acme.github.io/"],
    ["uppercase", "HTTPS://Acme.Example/", "https://acme.example/"],
  ])("accepts %s", (_label, raw, href) => {
    const result = classifyInput(raw);
    expect(result).toEqual({ kind: "url", url: href });
  });

  /** The planted platform links from the fetchOwnSite() box (docs/TASKS.md, M2). */
  it.each([
    "https://www.reddit.com/r/x",
    "https://old.reddit.com",
    "https://redd.it/a",
    "https://x.com/a",
    "https://t.co/a",
    "https://www.linkedin.com/in/a",
    "https://lnkd.in/a",
    "https://youtu.be/a",
    "https://bsky.app/profile/a",
    "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=a",
    "https://news.ycombinator.com/item?id=1",
    "https://hn.algolia.com/api/v1/search?query=a",
    "https://www-reddit-com.translate.goog/r/x",
    "https://web.archive.org/web/2026/https://www.reddit.com/",
    "https://www.producthunt.com/products/acme",
    "https://www.indiehackers.com/product/acme",
    "producthunt.com/posts/acme",
    "linkedin.com/company/acme",
    "https://reader.example/https://www.reddit.com/r/x",
  ])("refuses the platform link %s", (raw) => {
    expect(classifyInput(raw)).toEqual({
      kind: "refused",
      reason: "platform",
    });
  });

  it.each([
    "https://apps.apple.com/us/app/acme/id123456789",
    "https://play.google.com/store/apps/details?id=com.acme.app",
    "https://chromewebstore.google.com/detail/acme/abcdefghijklmnop",
    "https://chrome.google.com/webstore/detail/acme/abcdefghijklmnop",
    "https://www.g2.com/products/acme/reviews",
    "https://www.capterra.com/p/1/acme/",
    "https://www.trustpilot.com/review/acme.example",
    "https://medium.com/@acme",
    "https://mastodon.social/@acme",
    "https://linktr.ee/acme",
    "g2.com/products/acme",
    "https://github.com/acme/acme",
    "https://github.com/somebody",
    "https://gist.github.com/somebody/abc",
    "https://gitlab.com/acme/acme",
    "https://www.npmjs.com/package/acme",
    "npmjs.com/package/acme",
  ])("refuses the third-party page %s", (raw) => {
    expect(classifyInput(raw)).toEqual({
      kind: "refused",
      reason: "third_party",
    });
  });

  it.each(["https://acme.example/@ana", "acme.example/user/ana", "https://acme.example/in/ana"])(
    "refuses the profile path %s",
    (raw) => {
      expect(classifyInput(raw)).toEqual({
        kind: "refused",
        reason: "profile",
      });
    },
  );

  it.each([
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://localhost/",
    "https://acme.example:8443/",
    "https://user:pass@acme.example/",
    "ftp://acme.example/",
  ])("refuses %s as not a public website", (raw) => {
    expect(classifyInput(raw)).toMatchObject({ kind: "refused", reason: "invalid_url" });
  });
});

describe("classifyInput: people are never the input", () => {
  it.each(["founder@acme.example", "  Ana <ana@acme.example>  ", "mail ana@acme.example please"])(
    "refuses an email address: %s",
    (raw) => {
      expect(classifyInput(raw)).toEqual({
        kind: "refused",
        reason: "email",
      });
    },
  );

  it.each([
    "@acme_founder",
    "it is a tool by @somebody for invoices and receipts",
    "u/somebody",
    "made by u/somebody, a tool for freelancers to send invoices",
    "/u/somebody",
  ])("refuses a handle: %s", (raw) => {
    expect(classifyInput(raw)).toEqual({
      kind: "refused",
      reason: "handle",
    });
  });
});

describe("classifyInput: descriptions", () => {
  it("takes a sentence or two as a description, trimmed", () => {
    expect(classifyInput("  Invoices for freelancers who hate spreadsheets.  ")).toEqual({
      kind: "description",
      text: "Invoices for freelancers who hate spreadsheets.",
    });
  });

  it("keeps words that only look like handles out of the handle rule", () => {
    expect(classifyInput("A U-Haul style booking tool for menu/tabs at cafes")).toMatchObject({
      kind: "description",
    });
  });

  it("asks for more when the text is too short to work from", () => {
    expect(classifyInput("Acme")).toMatchObject({ kind: "refused", reason: "too_short" });
    expect(classifyInput("   ")).toMatchObject({ kind: "refused", reason: "too_short" });
  });

  it("refuses anything over 2,048 characters before any check runs", () => {
    const start = performance.now();
    expect(classifyInput("a".repeat(1_000_000))).toMatchObject({
      kind: "refused",
      reason: "too_long",
    });
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("refuses more than 1,000 characters", () => {
    expect(classifyInput("a ".repeat(501))).toMatchObject({ kind: "refused", reason: "too_long" });
  });

  it("collapses runs of whitespace", () => {
    expect(classifyInput("Invoices  for\n\nfreelancers,   sent from your phone.")).toEqual({
      kind: "description",
      text: "Invoices for freelancers, sent from your phone.",
    });
  });
});
