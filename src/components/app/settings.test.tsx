import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountData } from "./account-data";
import { EmailPreferences } from "./email-preferences";

/** Settings, Data and Email (docs/PLAN.md 4.7, 10.6, 10.7). The clicks run in tests/e2e/billing.spec.ts. */

describe("AccountData", () => {
  const html = renderToStaticMarkup(<AccountData deleteMyAccount={async () => ({})} />);

  it("links the JSON export and says post text is not in it", () => {
    expect(html).toContain('href="/api/export"');
    expect(html).toContain("Post text is not included.");
  });

  it("asks for DELETE, and the button starts disabled", () => {
    expect(html).toContain("Type DELETE to confirm");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete my account<\/button>/);
    expect(html).toContain("cancels your subscription at once");
  });
});

describe("EmailPreferences", () => {
  it("shows each list with its current state", () => {
    const html = renderToStaticMarkup(
      <EmailPreferences
        daily={true}
        weekly={false}
        setEmailPreference={async () => ({ ok: true })}
      />,
    );
    expect(html).toContain("New posts worth replying to, each morning");
    expect(html).toContain("Monday digest");
    expect((html.match(/checked=""/g) ?? []).length).toBe(1);
  });
});
