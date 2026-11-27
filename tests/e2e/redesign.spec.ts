import { devices, type Page } from "@playwright/test";
import { E2E_EMPTY_EMAIL, E2E_REDESIGN_EMAIL } from "../../playwright.config";
import {
  adminClient,
  choosePassword,
  createConfirmedUser,
  deleteUserByEmail,
  magicLinkPath,
} from "./support/auth";
import { e2eSkipReason } from "./support/guard";
import { expect, test } from "./support/test";

/**
 * The founder's redesign brief, TESTING (docs/design/redesign-brief.md): CTA destinations, pricing
 * disclosures, billing and external links, Save and Hide persistence, filters, the conversation
 * detail by keyboard, the product page, mobile navigation, no horizontal scroll at 375px and the
 * empty state, with screenshots at 1360px and on an iPhone 13. Localhost and the development
 * project only; every post is invented.
 */

const SHOTS = "test-results/redesign";
const POSTS = 12;
const IPHONE_13 = (({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch }) => ({
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch,
}))(devices["iPhone 13"]);

async function seed(email: string, posts: number): Promise<void> {
  const admin = adminClient();
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const id = users.users.find((u) => u.email === email)!.id;
  await admin.rpc("apply_billing_patch", {
    p_user_id: id,
    p_event_at: new Date().toISOString(),
    p_patch: { subscription_status: "trialing", plan: "pro" },
  });
  const { data: product, error } = await admin
    .from("products")
    .insert({
      owner_id: id,
      name: "Invoicer",
      url: "https://invoicer.example/",
      one_liner: "Example: chases late invoices for freelancers.",
      status: "active",
    })
    .select("id")
    .single();
  if (error || !product) throw new Error(`product insert failed: ${error?.code}`);
  await admin
    .from("search_terms")
    .insert({ product_id: product.id, term: "late invoices", intent: "problem" });
  const now = new Date().toISOString();
  for (let i = 0; i < posts; i++) {
    const source = i % 3 === 0 ? "bluesky" : "hackernews";
    const { data: postId } = await admin.rpc("ingest_post", {
      p_source: source,
      p_external_id: `e2e-redesign-${i}`,
      p_url:
        source === "bluesky"
          ? `https://bsky.app/profile/did:plc:e2einvented/post/e2e${i}`
          : `https://news.ycombinator.com/item?id=e2e-invented-${i}`,
      p_excerpt: `Example post ${i}: does anyone know a tool that chases late invoices for me?`,
      p_posted_at: now,
      p_author_hash: `e2e-redesign-hash-${i}`,
      p_community: source === "bluesky" ? "Bluesky" : "Hacker News",
      p_now: now,
    });
    await admin.from("product_posts").insert({
      product_id: product.id,
      post_id: postId as string,
      relevance: 70 + (i % 20),
      category: "looking_for_tool",
      reason: "Asks for a tool that sends invoice reminders.",
    });
  }
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(await magicLinkPath(email));
  if (page.url().includes("/app/terms")) {
    await page.getByLabel("I am 18 or older").check();
    await page.getByLabel(/I agree to the/).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await choosePassword(page);
    // Saving the password navigates on; a goto before it lands would cancel the save.
    await page.waitForURL((url) => !url.pathname.startsWith("/app/password"));
  }
}

/** True when the page scrolls sideways: wider content than the window. */
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

test.describe("homepage", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("one primary action with the full terms beside it, and a quiet See an example", async ({
    page,
  }) => {
    await page.goto("/");
    const hero = page.locator("section").filter({ has: page.locator("#hero") });
    const cta = hero.getByRole("link", { name: /Start your trial|Sign in with your invitation/ });
    await expect(cta).toHaveAttribute("href", "/login?next=%2Fapp");
    await expect(hero).toContainText(
      "£39 a month, tax included where it applies, after a 3-day trial for £1. Cancel in Settings in two clicks.",
    );
    await page.getByRole("link", { name: "See an example" }).click();
    await expect(page.locator("#example")).toBeInViewport();
    await page.screenshot({ path: `${SHOTS}/home-1360.png`, fullPage: true });
  });

  test("every primary CTA goes to sign-in, and the pricing page shows the terms", async ({
    page,
  }) => {
    await page.goto("/");
    const ctas = page.getByRole("main").getByRole("link", {
      name: /^(Start your trial|Sign in with your invitation)$/,
    });
    expect(await ctas.count()).toBeGreaterThanOrEqual(3);
    for (const href of await ctas.evaluateAll((els) => els.map((e) => e.getAttribute("href"))))
      expect(href).toBe("/login?next=%2Fapp");
    await page.goto("/pricing");
    await expect(page.getByRole("main")).toContainText("£39");
    await expect(page.getByRole("main")).toContainText("£1");
    await expect(page.getByRole("main")).toContainText(/cancel/i);
  });

  test("every footer and legal link opens a working page", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page
      .locator("footer a[href^='/']")
      .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("href")!))]);
    expect(hrefs.length).toBeGreaterThan(3);
    for (const href of hrefs) {
      const response = await page.request.get(href, { maxRedirects: 0 });
      expect(response.status(), href).toBeLessThan(400);
    }
  });
});

test.describe("the app with the development project", () => {
  const reason = e2eSkipReason(process.env);
  test.skip(reason !== null, `Skipped: ${reason}`);
  test.use({ viewport: { width: 1360, height: 900 } });

  test.beforeAll(async () => {
    await createConfirmedUser(E2E_REDESIGN_EMAIL);
    await createConfirmedUser(E2E_EMPTY_EMAIL);
    await seed(E2E_REDESIGN_EMAIL, POSTS);
    await seed(E2E_EMPTY_EMAIL, 0);
  });
  test.afterAll(async () => {
    await adminClient().from("posts").delete().like("external_id", "e2e-redesign-%");
    await deleteUserByEmail(E2E_REDESIGN_EMAIL);
    await deleteUserByEmail(E2E_EMPTY_EMAIL);
  });

  test("Save and Hide persist through a reload", async ({ page }) => {
    await signIn(page, E2E_REDESIGN_EMAIL);
    await page.goto("/app/reply?view=all");
    const cards = page.locator("[data-feed-card]");
    await expect(cards).toHaveCount(POSTS);
    await cards.nth(0).getByRole("button", { name: "Save" }).click();
    await expect(cards.nth(0).getByRole("status")).toHaveText("Saved.");
    await cards.nth(1).getByRole("button", { name: "Hide" }).click();
    await expect(cards.nth(1).getByRole("status")).toHaveText("Hidden.");
    await page.reload();
    await expect(cards).toHaveCount(POSTS - 1);
    await expect(cards.nth(0).getByRole("button", { name: "Save" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.goto("/app/reply?view=hidden");
    await expect(cards).toHaveCount(1);
    await page.goto("/app/reply?view=saved");
    await expect(cards).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/saved-1360.png` });
  });

  test("filters narrow the feed, and Clear filters brings it back", async ({ page }) => {
    await signIn(page, E2E_REDESIGN_EMAIL);
    await page.goto("/app/reply?view=all&q=nothingmatchesthis");
    await expect(page.getByText("No conversations match these filters.")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/app\/reply\?view=all$/);
    await expect(page.locator("[data-feed-card]").first()).toBeVisible();
  });

  test("the conversation detail opens by keyboard, keeps focus inside and closes with Escape", async ({
    page,
  }) => {
    await signIn(page, E2E_REDESIGN_EMAIL);
    await page.goto("/app/reply?view=all");
    const details = page
      .locator("[data-feed-card]")
      .first()
      .getByRole("button", { name: "Details" });
    await details.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Conversation" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Conversation" })).toBeFocused();
    await expect(dialog).toContainText("We keep up to 280 characters of each post.");
    await expect(dialog).toContainText("Why it matched");
    await expect(dialog).toContainText("Say you built it.");
    const link = dialog.getByRole("link", { name: /View conversation/ });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await page.screenshot({ path: `${SHOTS}/detail-1360.png` });
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(details).toBeFocused();
  });

  test("the product page saves the profile, and the side panel links to it", async ({ page }) => {
    await signIn(page, E2E_REDESIGN_EMAIL);
    await page.goto("/app/reply");
    await page
      .getByRole("navigation", { name: "Main" })
      .first()
      .getByRole("link", { name: "Product" })
      .click();
    await expect(page).toHaveURL(/\/app\/product$/);
    await expect(page.getByRole("heading", { name: "How this shapes your feed" })).toBeVisible();
    await page.getByLabel("One-line summary").fill("Example: sends invoice reminders.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("One-line summary")).toHaveValue(
      "Example: sends invoice reminders.",
    );
    // Below 40: the browser's own check stops the form (the server and the database refuse it too).
    await page.getByLabel("Minimum match").fill("20");
    await page.getByRole("button", { name: "Save changes" }).click();
    expect(
      await page
        .getByLabel("Minimum match")
        .evaluate((el) => (el as HTMLInputElement).validity.rangeUnderflow),
    ).toBe(true);
    await page.reload();
    await expect(page.getByLabel("Minimum match")).not.toHaveValue("20");
    await page.screenshot({ path: `${SHOTS}/product-1360.png`, fullPage: true });
  });

  test("with no conversations, the empty state offers Review product", async ({ page }) => {
    await signIn(page, E2E_EMPTY_EMAIL);
    await page.goto("/app/reply?view=all");
    await expect(page.getByText("No conversations to show yet.")).toBeVisible();
    await page.getByRole("link", { name: "Review product" }).click();
    await expect(page).toHaveURL(/\/app\/product$/);
    await page.goto("/app/reply?view=all");
    await page.screenshot({ path: `${SHOTS}/empty-1360.png` });
  });

  test.describe("on a phone", () => {
    test.use(IPHONE_13);

    test("no page scrolls sideways at 375px or on an iPhone 13", async ({ page }) => {
      await signIn(page, E2E_REDESIGN_EMAIL);
      for (const width of [375, 390]) {
        await page.setViewportSize({ width, height: 812 });
        for (const path of [
          "/",
          "/pricing",
          "/app/reply?view=all",
          "/app/product",
          "/app/settings",
        ]) {
          await page.goto(path);
          expect(await scrollsSideways(page), `${path} at ${width}px`).toBe(false);
        }
      }
    });

    test("the drawer reaches every view, Product and Settings, and the tab bar stays", async ({
      page,
    }) => {
      await signIn(page, E2E_REDESIGN_EMAIL);
      await page.goto("/app/reply");
      await page.screenshot({ path: `${SHOTS}/reply-iphone13.png` });
      await page.getByRole("button", { name: "Menu" }).click();
      const drawer = page.getByRole("dialog", { name: "Menu" });
      await expect(drawer).toBeVisible();
      for (const name of ["Today", "All conversations", "Saved", "Hidden", "Product", "Settings"])
        await expect(drawer.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/drawer-iphone13.png` });
      await drawer.getByRole("link", { name: /^Product/ }).click();
      await expect(page).toHaveURL(/\/app\/product$/);
      await expect(drawer).toBeHidden();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    });

    test("filters open as a sheet and apply", async ({ page }) => {
      await signIn(page, E2E_REDESIGN_EMAIL);
      await page.goto("/app/reply?view=all");
      await page.getByRole("button", { name: /^Filters/ }).click();
      const sheet = page.getByRole("dialog", { name: "Filters" });
      await expect(sheet).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/filters-iphone13.png` });
      await sheet.getByLabel("Search").fill("Example post 3");
      await sheet.getByRole("button", { name: "Apply" }).click();
      await expect(page).toHaveURL(/q=Example\+post\+3/);
      await expect(page.locator("[data-feed-card]")).toHaveCount(1);
    });

    test("the conversation detail is full screen", async ({ page }) => {
      await signIn(page, E2E_REDESIGN_EMAIL);
      await page.goto("/app/reply?view=all");
      await page
        .locator("[data-feed-card]")
        .first()
        .getByRole("button", { name: "Details" })
        .click();
      const dialog = page.getByRole("dialog", { name: "Conversation" });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      const size = page.viewportSize()!;
      expect(box!.width).toBeGreaterThanOrEqual(size.width - 1);
      await page.screenshot({ path: `${SHOTS}/detail-iphone13.png` });
    });
  });
});
