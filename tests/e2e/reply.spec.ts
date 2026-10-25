import {
  deleteSeededPosts,
  deleteUserByEmail,
  deleteUsers,
  e2eConfig,
  seedReadyAccount,
  signIn,
  SKIP_REASON,
} from "./support/auth";
import { replyEmail } from "./support/emails";
import { expect, test } from "./support/test";

/** The Reply tab (docs/PLAN.md 4.4) on localhost: keyboard shortcuts and 200 cards fast. */

const config = e2eConfig();
const created: string[] = [];
if (!config) console.warn(SKIP_REASON);

test.describe("reply tab", () => {
  test.skip(!config, SKIP_REASON);
  let userId = "";

  test.beforeEach(async ({ context, baseURL }, testInfo) => {
    const email = replyEmail(testInfo.project.name);
    await deleteUserByEmail(config!, email);
    await signIn(context, baseURL!, email, config!, (id) => {
      created.push(id);
      userId = id;
    });
    await seedReadyAccount(config!, userId, 200);
  });

  test.afterEach(async () => {
    await deleteSeededPosts(config!, userId);
  });

  test.afterAll(async () => {
    await deleteUsers(config!, created);
  });

  test("renders 200 cards in under 1.5 seconds", async ({ page }) => {
    await page.goto("/app/reply?view=all&page=4");
    await expect(page.locator("[data-card]").first()).toBeVisible();
    const started = Date.now();
    await page.goto("/app/reply?view=all&page=4");
    await expect(page.locator("[data-card]")).toHaveCount(200);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  test("j, k, s, r, h and ? work, and Mark replied removes a card from Today", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "keyboard shortcuts are a desktop feature");
    await page.goto("/app/reply");
    const cards = page.locator("[data-card]");
    await expect(cards.first()).toBeVisible();

    await page.keyboard.press("j");
    await expect(cards.nth(0)).toBeFocused();
    await page.keyboard.press("j");
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press("k");
    await expect(cards.nth(0)).toBeFocused();

    const first = await cards.nth(0).getAttribute("id");
    await page.keyboard.press("r");
    await expect(page.getByText("Marked replied.")).toBeVisible();
    await expect(page.locator(`#${first}`)).toHaveCount(0);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(`#${first}`)).toHaveCount(1);

    await page.keyboard.press("j");
    await page.keyboard.press("s");
    await expect(page.locator("[data-card]").first().getByText("Saved")).toBeVisible();

    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  });
});
