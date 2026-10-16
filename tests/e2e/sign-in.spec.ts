import { deleteUserByEmail, deleteUsers, e2eConfig, signIn, SKIP_REASON } from "./support/auth";
import { signInEmail } from "./support/emails";
import { expect, test } from "./support/test";

const config = e2eConfig();
const created: string[] = [];
if (!config) console.warn(SKIP_REASON);

test("an anonymous visitor is sent to sign in and back", async ({ page }) => {
  await page.goto("/app/rivals?x=1");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Frivals%3Fx%3D1$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
});

test("/admin looks exactly like a page that does not exist", async ({ page }) => {
  const admin = await page.goto("/admin");
  expect(admin?.status()).toBe(404);
  const adminText = await page.locator("body").innerText();
  const unknown = await page.goto("/no-such-page-here");
  expect(unknown?.status()).toBe(404);
  expect(await page.locator("body").innerText()).toBe(adminText);
  // The encoded form Next would route to /admin gets the same answer.
  expect((await page.goto("/%61dmin"))?.status()).toBe(404);
  expect((await page.goto("/admin/removals/1.txt"))?.status()).toBe(404);
});

test.describe("sign-in", () => {
  test.skip(!config, SKIP_REASON);

  test.beforeEach(async ({}, testInfo) => {
    await deleteUserByEmail(config!, signInEmail(testInfo.project.name));
  });

  test.afterAll(async () => {
    await deleteUsers(config!, created);
  });

  test("a new user confirms age and terms, then lands on onboarding", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await signIn(context, baseURL!, signInEmail(testInfo.project.name), config!, (id) =>
      created.push(id),
    );

    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/welcome$/);
    await page.getByLabel("I am 18 or older.").check();
    await page.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/\/app\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Set up your product" })).toBeVisible();
  });
});
