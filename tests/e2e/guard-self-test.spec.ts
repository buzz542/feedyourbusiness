import { expect, test } from "./support/test";

/**
 * The localhost guard must be seen to work (CLAUDE.md, "a gate that has never been seen to fail").
 * Each test leaves localhost on purpose and declares exactly which host the guard must record;
 * the guard compares that list exactly, so a guard that records nothing fails these tests. Nothing
 * ever connects: the request is aborted and the browser's proxy is dead.
 */
test.use({ expectedOffSite: ["example.invalid"] });

test("records a page that loads a third-party image", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.setContent('<img src="https://example.invalid/pixel.png" alt="">');
  await page.waitForTimeout(300);
});

test("records a redirect that leaves localhost", async ({ page }) => {
  // A local URL that answers with a redirect to another site (route handlers miss redirect hops).
  await page.route("**/leave", (route) =>
    route.fulfill({ status: 302, headers: { location: "https://example.invalid/landing" } }),
  );
  await page.goto("/leave").catch(() => {});
});
