import { expect, test } from "./support/test";
import { E2E_EMAIL } from "../../playwright.config";
import { createConfirmedUser, deleteUserByEmail, magicLinkPath } from "./support/auth";
import { e2eSkipReason } from "./support/guard";

test.describe("without an account", () => {
  test("an anonymous visitor to the app is sent to sign in, with the page to return to", async ({
    page,
  }) => {
    await page.goto("/app/reply");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Freply$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("admin answers 404 to an anonymous visitor", async ({ request }) => {
    const response = await request.get("/admin");
    expect(response.status()).toBe(404);
  });
});

test.describe("sign-in with the development project", () => {
  const reason = e2eSkipReason(process.env);
  test.skip(reason !== null, `Skipped: ${reason}`);

  test.afterAll(async () => {
    await deleteUserByEmail(E2E_EMAIL);
  });

  test("a new allowed user follows a magic link, confirms, and lands on onboarding", async ({
    page,
  }) => {
    await createConfirmedUser(E2E_EMAIL);
    await page.goto(await magicLinkPath(E2E_EMAIL));

    // First sign-in: the two confirmations on one screen.
    await expect(page).toHaveURL(/\/app\/terms$/);
    await page.getByLabel("I am 18 or older").check();
    await page.getByLabel(/I agree to the/).check();
    await page.getByRole("button", { name: "Continue" }).click();

    // No product yet, so /app sends them to onboarding.
    await expect(page).toHaveURL(/\/app\/onboarding$/);
  });
});
