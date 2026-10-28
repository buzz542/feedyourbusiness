import { expect, test } from "./support/test";
import { E2E_EMAIL } from "../../playwright.config";
import {
  createConfirmedUser,
  deleteUserByEmail,
  magicLinkPath,
  productForEmail,
} from "./support/auth";
import { e2eSkipReason } from "./support/guard";

/**
 * Onboarding (docs/PLAN.md 4.3) on localhost, with E2E_FAKE_SERVICES: the draft comes from a
 * fixture page and a canned model, and everything else is real, the development project included.
 */
test.describe("onboarding with fake services", () => {
  const reason = e2eSkipReason(process.env);
  test.skip(reason !== null, `Skipped: ${reason}`);

  test.afterAll(async () => {
    await deleteUserByEmail(E2E_EMAIL);
  });

  test("drafts from a URL, keeps the owner's edits, and confirms the product", async ({ page }) => {
    await createConfirmedUser(E2E_EMAIL);
    await page.goto(await magicLinkPath(E2E_EMAIL));
    await page.getByLabel("I am 18 or older").check();
    await page.getByLabel(/I agree to the/).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app\/onboarding$/);

    // Step 1: the product URL, drafted from the fixture page.
    await page.getByLabel("Your product's web address").fill("e2e-product.example");
    await page.getByRole("button", { name: "Draft my setup" }).click();
    await expect(page.getByRole("heading", { name: "Check your draft" })).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("E2E Product");

    // Step 2: edit every kind of field, then save.
    await page.getByLabel("Name", { exact: true }).fill("E2E Product Edited");
    await page.getByLabel("Minimum match (40 to 95)").fill("75");
    await page.getByLabel("New search term").fill("need a better invoice tool");
    await page.getByRole("button", { name: "Add term" }).click();
    await page
      .getByRole("button", { name: "Remove how do I get clients to pay invoice 0" })
      .click();
    await page.getByLabel(/^Subreddits for your search links/).fill("freelance, depression");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toContainText("We left out r/depression");

    // The edits persist across a reload.
    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("E2E Product Edited");
    await expect(page.getByLabel("Minimum match (40 to 95)")).toHaveValue("75");
    const saved = await productForEmail(E2E_EMAIL);
    expect(saved).toMatchObject({
      status: "draft",
      confirmed_at: null,
      name: "E2E Product Edited",
      relevance_threshold: 75,
      subreddits: ["freelance"],
    });
    expect(saved!.terms).toContain("need a better invoice tool");
    expect(saved!.terms).not.toContain("how do I get clients to pay invoice 0");

    // Confirm: the product becomes active with confirmed_at, and /app moves on to billing.
    await page.getByRole("button", { name: "Confirm and continue" }).click();
    await expect(page).toHaveURL(/\/app\/billing$/);
    const confirmed = await productForEmail(E2E_EMAIL);
    expect(confirmed!.status).toBe("active");
    expect(confirmed!.confirmed_at).not.toBeNull();
  });
});
