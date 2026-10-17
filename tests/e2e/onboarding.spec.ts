import type { Page } from "@playwright/test";
import {
  deleteUserByEmail,
  deleteUsers,
  e2eConfig,
  productOf,
  signIn,
  SKIP_REASON,
} from "./support/auth";
import { onboardingEmail } from "./support/emails";
import { expect, test } from "./support/test";

/**
 * Onboarding (docs/PLAN.md 4.3) on localhost with fake services (E2E_FAKE_SERVICES=1: no site is
 * fetched and no model is called): draft, edit every kind of field, save, reload, confirm.
 */

const config = e2eConfig();
const created: string[] = [];
if (!config) console.warn(SKIP_REASON);

async function startOnboarding(page: Page) {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/welcome$/);
  await page.getByLabel("I am 18 or older.").check();
  await page.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding$/);
}

test.describe("onboarding", () => {
  test.skip(!config, SKIP_REASON);

  let userId = "";

  test.beforeEach(async ({ context, baseURL }, testInfo) => {
    const email = onboardingEmail(testInfo.project.name);
    await deleteUserByEmail(config!, email);
    await signIn(context, baseURL!, email, config!, (id) => {
      created.push(id);
      userId = id;
    });
  });

  test.afterAll(async () => {
    await deleteUsers(config!, created);
  });

  test("drafts from a URL; edits persist; confirm makes the product active", async ({ page }) => {
    await startOnboarding(page);

    await page.getByLabel("Your product's web address").fill("invoicer.example");
    await page.getByRole("button", { name: "Draft my profile" }).click();
    await expect(page.getByRole("heading", { name: "Review your profile" })).toBeVisible({
      timeout: 30_000,
    });

    const terms = page.getByRole("list", { name: "Search terms" });
    const subreddits = page.getByRole("list", { name: "Subreddits" });
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Invoicer");
    await expect(terms.getByText("alternative to Ledgerly")).toBeVisible();
    // The fake model suggests r/depression; the sensitive-community list drops it (2.3.7).
    await expect(subreddits.getByText("r/freelance")).toBeVisible();
    await expect(subreddits.getByText("r/depression")).toHaveCount(0);

    // Edit a text field, a term (remove and add), a competitor, a subreddit and the threshold.
    await page.getByLabel("Name", { exact: true }).fill("Invoicer Pro");
    await page.getByRole("button", { name: 'Remove "Ledgerly too expensive"' }).click();
    await page.getByLabel("Add a term").fill("chase late invoices");
    await page.getByLabel("Add a term").press("Enter");
    await page.getByRole("button", { name: "Add a competitor" }).click();
    await page.getByLabel("Competitor name").last().fill("Paidly");
    await page.getByLabel("Domain (optional)").last().fill("https://www.paidly.example/");
    await page.getByLabel("Add a subreddit").fill("r/SaaS");
    await page.getByLabel("Add a subreddit").press("Enter");
    await page.getByLabel("Minimum match").fill("70");
    // Enter in a text field never confirms (only the Confirm button does).
    await page.getByLabel("Name", { exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "Review your profile" })).toBeVisible();
    expect((await productOf(config!, userId))?.status).toBe("draft");

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/app\/onboarding\?saved=1$/);
    await expect(page.getByText("Changes saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Invoicer Pro");
    await expect(terms.getByText("chase late invoices")).toBeVisible();
    await expect(terms.getByText("Ledgerly too expensive")).toHaveCount(0);
    await expect(page.getByLabel("Domain (optional)").last()).toHaveValue("paidly.example");
    await expect(subreddits.getByText("r/SaaS")).toBeVisible();
    await expect(page.getByLabel("Minimum match")).toHaveValue("70");
    expect(await productOf(config!, userId)).toMatchObject({
      name: "Invoicer Pro",
      status: "draft",
      confirmed_at: null,
    });

    await page.getByRole("button", { name: "Confirm and continue" }).click();
    await expect(page).toHaveURL(/\/app\/billing$/);
    await expect(page.getByRole("heading", { name: "Start your trial" })).toBeVisible();
    const product = await productOf(config!, userId);
    expect(product?.status).toBe("active");
    expect(product?.confirmed_at).not.toBeNull();
  });

  test("falls back to a pasted description when the site cannot be read", async ({ page }) => {
    await startOnboarding(page);

    await page.getByLabel("Your product's web address").fill("unreachable.example");
    await page.getByRole("button", { name: "Draft my profile" }).click();
    // By id: Next's route announcer is also role="alert".
    await expect(page.locator("#draft-message")).toContainText("We could not read that page");
    await page
      .getByLabel("Describe your product")
      .fill("Invoicer sends polite reminders to clients who have not paid their invoices yet.");
    await page.getByRole("button", { name: "Draft from my description" }).click();
    await expect(page.getByRole("heading", { name: "Review your profile" })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("the URL step explains a bad address without drafting", async ({ page }) => {
    await startOnboarding(page);
    await page.getByLabel("Your product's web address").fill("not a url");
    await page.getByRole("button", { name: "Draft my profile" }).click();
    await expect(page.locator("#draft-message")).toHaveText(
      "Enter your product's web address, like example.com.",
    );
  });
});
