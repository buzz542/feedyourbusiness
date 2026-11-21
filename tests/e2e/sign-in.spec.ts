import { expect, test } from "./support/test";
import { E2E_EMAIL } from "../../playwright.config";
import {
  E2E_PASSWORD,
  choosePassword,
  createConfirmedUser,
  deleteUserByEmail,
  magicLinkPath,
} from "./support/auth";
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

    // Then a password, so the next sign-in needs no email link.
    await choosePassword(page);

    // No product yet, so /app sends them to onboarding.
    await expect(page).toHaveURL(/\/app\/onboarding$/);
  });

  test("after choosing a password, the person signs in again with it and no email link", async ({
    page,
  }) => {
    await createConfirmedUser(E2E_EMAIL);
    await page.goto(await magicLinkPath(E2E_EMAIL));
    await page.getByLabel("I am 18 or older").check();
    await page.getByLabel(/I agree to the/).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await choosePassword(page);
    await expect(page).toHaveURL(/\/app\/onboarding$/);

    // A new visit with no cookies: only the password can get them back in.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(E2E_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/onboarding$/);

    // A wrong password is refused, with the same words whoever the email belongs to.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(E2E_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill("not the password at all");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("That email and password do not match.")).toBeVisible();
  });
});
