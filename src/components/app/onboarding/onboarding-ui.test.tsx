import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/app/(app)/app/onboarding/actions", () => ({
  draftFromUrlAction: vi.fn(),
  draftFromDescriptionAction: vi.fn(),
  saveProfileAction: vi.fn(),
  confirmProfileAction: vi.fn(),
}));

const { ReviewForm } = await import("./review-form");
const { UrlStep } = await import("./url-step");
const { DraftProgress, PROGRESS_STEPS } = await import("./draft-progress");
const { draftMessage } = await import("./draft-messages");

/** The onboarding screens (docs/PLAN.md 4.3) as first rendered: labels, values and wiring. */

const DRAFT = {
  name: "Invoicer",
  one_liner: "Invoices that chase themselves",
  description: "A small tool for freelancers.",
  audience: "Freelancers",
  relevance_threshold: 60,
  subreddits: ["freelance", "SaaS"],
  terms: [
    { term: "how do I chase an invoice", intent: "problem" as const },
    { term: "alternative to Ledgerly", intent: "alternative" as const },
  ],
  competitors: [{ id: "c1", name: "Ledgerly", domain: "ledgerly.example", aliases: ["LDG"] }],
};

describe("ReviewForm", () => {
  const html = renderToStaticMarkup(<ReviewForm draft={DRAFT} saved={false} />);

  it("labels every field and fills it from the draft", () => {
    for (const [id, value] of [
      ["name", "Invoicer"],
      ["one_liner", "Invoices that chase themselves"],
      ["competitor-c1-name", "Ledgerly"],
      ["competitor-c1-domain", "ledgerly.example"],
      ["competitor-c1-aliases", "LDG"],
    ]) {
      expect(html, id).toContain(`for="${id}"`);
      expect(html, id).toMatch(new RegExp(`id="${id}"[^>]*value="${value}"`));
    }
    expect(html).toMatch(/<textarea[^>]*id="description"[^>]*>A small tool for freelancers\.</);
    expect(html).toMatch(/id="threshold"[^>]*type="range"|type="range"[^>]*id="threshold"/);
  });

  it("shows terms as removable chips with their intent, and the counts", () => {
    expect(html).toContain("how do I chase an invoice");
    expect(html).toContain("Alternative");
    expect(html).toContain('aria-label="Remove &quot;alternative to Ledgerly&quot;"');
    expect(html).toContain("2 of 40 terms");
    expect(html).toContain("r/SaaS");
    expect(html).toContain('aria-label="Remove r/SaaS"');
    expect(html).toContain("2 of 10 subreddits");
  });

  it("offers save, confirm and starting again", () => {
    expect(html).toContain("Confirm and continue");
    expect(html).toContain("Save changes");
    expect(html).toContain('href="/app/onboarding?step=url"');
  });

  it("announces a save", () => {
    expect(renderToStaticMarkup(<ReviewForm draft={DRAFT} saved />)).toMatch(
      /role="status"[^>]*>Changes saved\./,
    );
  });
});

describe("UrlStep", () => {
  it("labels the address field and ties the message to it", () => {
    const html = renderToStaticMarkup(<UrlStep initialUrl="" hasDraft={false} />);
    expect(html).toContain('for="product-url"');
    expect(html).toMatch(/id="product-url"[^>]*aria-describedby="draft-message"/);
    expect(html).toMatch(/id="draft-message"[^>]*role="alert"/);
    expect(html).toContain("Draft my profile");
    expect(html).not.toContain("Back to my draft");
  });

  it("offers a way back when a draft exists", () => {
    const html = renderToStaticMarkup(<UrlStep initialUrl="https://a.example/" hasDraft />);
    expect(html).toContain("Back to my draft");
    expect(html).toContain('value="https://a.example/"');
  });
});

describe("DraftProgress", () => {
  it("is a polite live region listing every step", () => {
    const html = renderToStaticMarkup(<DraftProgress fromDescription={false} />);
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
    for (const step of PROGRESS_STEPS) expect(html).toContain(step);
    expect(html).toContain('aria-current="step"');
  });
});

describe("draftMessage", () => {
  it("offers the description form when the page cannot be read", () => {
    expect(draftMessage({ ok: false, reason: "site_unreachable", siteError: "timeout" })).toEqual({
      text: "We could not read that page: the site took too long to answer. Describe your product in a few sentences instead.",
      offerDescription: true,
    });
  });

  it("explains every failure, and leaves already_confirmed to a reload", () => {
    for (const reason of [
      "invalid_url",
      "invalid_description",
      "declined",
      "timeout",
      "spend_cap",
      "unavailable",
      "failed",
    ] as const)
      expect(draftMessage({ ok: false, reason })?.text, reason).toBeTruthy();
    expect(draftMessage({ ok: false, reason: "already_confirmed" })).toBeNull();
  });
});
