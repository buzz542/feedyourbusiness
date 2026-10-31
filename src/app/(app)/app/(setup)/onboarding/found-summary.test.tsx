import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FoundSummary } from "./found-summary";

/** "Here's what we found" (docs/PLAN.md 4.3 step 4). Invented product. */
const view = {
  product: {
    id: "p1",
    url: "https://invoicer.example/",
    name: "Invoicer",
    one_liner: "Invoices from a photo of a receipt.",
    description: "Invoicer turns receipts into invoices.",
    audience: "Freelancers who bill clients",
    subreddits: ["freelance", "smallbusiness"],
    relevance_threshold: 60,
    status: "draft",
    updated_at: "2026-10-31T12:00:00Z",
  },
  terms: Array.from({ length: 11 }, (_, i) => ({ id: `t${i}`, term: `invoice term ${i}` })),
  competitors: [
    { id: "c1", name: "Billfast", domain: "billfast.example", aliases: ["Billfast App"] },
    { id: "c2", name: "Ledgerly", domain: null, aliases: [] },
  ],
};

describe("FoundSummary", () => {
  const html = renderToStaticMarkup(<FoundSummary view={view} />);

  it("says what the product does and for whom", () => {
    expect(html).toContain("Invoicer");
    expect(html).toContain("Invoices from a photo of a receipt.");
    expect(html).toContain("Freelancers who bill clients");
  });

  it("shows competitors as chips with their other names", () => {
    expect(html).toContain("Billfast");
    expect(html).toContain("(also Billfast App)");
    expect(html).toContain("Ledgerly");
  });

  it("shows the first 8 terms and counts the rest", () => {
    expect(html).toContain("invoice term 7");
    expect(html).not.toContain("invoice term 8");
    expect(html).toContain("and 3 more terms");
  });

  it("shows the communities", () => {
    expect(html).toContain("r/freelance");
    expect(html).toContain("r/smallbusiness");
  });
});
