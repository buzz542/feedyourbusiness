import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductForm, type ProductFormView } from "./product-form";

/**
 * The product profile form (/app/product, the founder's redesign brief): every field matching
 * reads, labeled; the caps on search terms said up front; what it changes said without promising
 * results. Invented data.
 */

const product: ProductFormView = {
  name: "Invoicer",
  url: "https://invoicer.example/",
  one_liner: "Chases late invoices for freelancers.",
  description: "Sends polite reminders until an invoice is paid.",
  audience: "Freelancers and small agencies.",
  relevance_threshold: 60,
  terms: ["late invoices", "chasing clients for payment"],
};

const visible = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

describe("ProductForm", () => {
  const html = renderToStaticMarkup(<ProductForm product={product} action={async (s) => s} />);

  it("labels every field and fills it with what is saved", () => {
    for (const [id, label] of [
      ["product-name", "Name"],
      ["product-url", "Website"],
      ["product-one_liner", "One-line summary"],
      ["product-description", "What it does and the problem it solves"],
      ["product-audience", "Who it's for"],
      ["product-terms", "Search terms, one a line"],
      ["product-threshold", "Minimum match"],
    ] as const)
      expect(html).toMatch(
        new RegExp(`<label[^>]*for="${id}"[^>]*>${label.replace("'", "&#x27;")}`),
      );
    expect(html).toContain('value="https://invoicer.example/"');
    expect(html).toContain("late invoices\nchasing clients for payment");
    expect(html).toMatch(/min="40"[^>]*max="95"|max="95"[^>]*min="40"/);
  });

  it("says the caps on brand names and alternative phrases before anyone hits them", () => {
    expect(visible(html)).toContain(
      'Up to 40. At most 3 that are only a competitor\'s name, and 4 "alternative to" phrases.',
    );
  });

  it("explains how the profile shapes matching, without promising results", () => {
    const out = visible(html);
    expect(out).toContain("How this shapes your feed");
    expect(out).toContain("decide whether you can help");
    for (const promise of ["guarantee", "every post", "perfect"])
      expect(out.toLowerCase()).not.toContain(promise);
  });

  it("has one save button and a live status line", () => {
    expect(html.match(/<button[^>]*type="submit"/g)).toHaveLength(1);
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
  });
});
