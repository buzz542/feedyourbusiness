import { expect, test } from "@playwright/test";
import {
  createE2EUser,
  deleteE2EUser,
  hasSupabaseAdmin,
  signIn,
  SKIP_REASON,
} from "./helpers/auth";

test.describe("sign-in", () => {
  test.skip(!hasSupabaseAdmin(), SKIP_REASON);

  test.afterEach(async () => {
    await deleteE2EUser();
  });

  test("a new user with terms accepted lands on onboarding", async ({ page }) => {
    await createE2EUser({ termsAccepted: true });
    await signIn(page);
    await page.waitForURL("**/app/onboarding");
    await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();
  });

  test("a new user confirms age and terms first, then lands on onboarding", async ({ page }) => {
    await createE2EUser();
    await signIn(page);
    await page.waitForURL("**/app/terms");
    await page.getByLabel("I am 18 or older.").check();
    await page.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/app/onboarding");
  });
});

test("anonymous visitors are sent to sign in", async ({ page }) => {
  await page.goto("/app/reply");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Freply$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
