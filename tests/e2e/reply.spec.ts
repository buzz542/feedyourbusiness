import { expect, test } from "./support/test";
import { E2E_REPLY_EMAIL } from "../../playwright.config";
import { adminClient, createConfirmedUser, deleteUserByEmail, magicLinkPath } from "./support/auth";
import { e2eSkipReason } from "./support/guard";

/**
 * The Reply tab (docs/PLAN.md 4.4, M5): 200 seeded cards render in under 1.5 seconds, and the
 * keys j, k, o, s, r, h and ? work. Invented posts only, on the development project.
 */

const EMAIL = E2E_REPLY_EMAIL;
const COUNT = 200;

async function seed(): Promise<void> {
  const admin = adminClient();
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const id = users.users.find((u) => u.email === EMAIL)!.id;
  // Entitled, as the webhook would leave a trial.
  await admin.rpc("apply_billing_patch", {
    p_user_id: id,
    p_event_at: new Date().toISOString(),
    p_patch: { subscription_status: "trialing", plan: "pro" },
  });
  const { data: product, error } = await admin
    .from("products")
    .insert({ owner_id: id, name: "Invoicer", status: "active" })
    .select("id")
    .single();
  if (error || !product) throw new Error(`product insert failed: ${error?.code}`);
  const now = new Date().toISOString();
  for (let i = 0; i < COUNT; i++) {
    const { data: postId } = await admin.rpc("ingest_post", {
      p_source: "hackernews",
      p_external_id: `e2e-reply-${i}`,
      p_url: `https://news.ycombinator.com/item?id=${900000 + i}`,
      p_excerpt: `Invented post ${i}: is there a tool that chases late invoices for freelancers?`,
      p_posted_at: now,
      p_author_hash: `e2e-hash-${i}`,
      p_community: "Hacker News",
      p_now: now,
    });
    await admin.from("product_posts").insert({
      product_id: product.id,
      post_id: postId as string,
      relevance: 60 + (i % 40),
      category: "looking_for_tool",
      reason: "Asks for an invoice tool.",
    });
  }
}

test.describe("Reply tab with the development project", () => {
  const reason = e2eSkipReason(process.env);
  test.skip(reason !== null, `Skipped: ${reason}`);

  test.beforeAll(async () => {
    await createConfirmedUser(EMAIL);
    await seed();
  });
  test.afterAll(async () => {
    const admin = adminClient();
    await admin.from("posts").delete().like("external_id", "e2e-reply-%");
    await deleteUserByEmail(EMAIL);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(await magicLinkPath(EMAIL));
    if (page.url().includes("/app/terms")) {
      await page.getByLabel("I am 18 or older").check();
      await page.getByLabel(/I agree to the/).check();
      await page.getByRole("button", { name: "Continue" }).click();
    }
  });

  test("200 cards render in under 1.5 seconds", async ({ page }) => {
    await page.goto("/app/reply?view=all");
    const started = Date.now();
    await page.goto("/app/reply?view=all&page=4");
    await expect(page.locator("[data-feed-card]")).toHaveCount(COUNT);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  test("j and k move between cards; s, r and h act on the current card; ? shows the keys", async ({
    page,
  }) => {
    await page.goto("/app/reply?view=all");
    const cards = page.locator("[data-feed-card]");
    await page.keyboard.press("j");
    await expect(cards.nth(0)).toBeFocused();
    await page.keyboard.press("j");
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press("k");
    await expect(cards.nth(0)).toBeFocused();
    await page.keyboard.press("s");
    await expect(cards.nth(0).getByRole("status")).toHaveText("Saved.");
    await page.keyboard.press("r");
    await expect(cards.nth(0).getByRole("status")).toHaveText("Marked replied.");
    await page.keyboard.press("j");
    await page.keyboard.press("h");
    await expect(cards.nth(1).getByRole("status")).toHaveText("Hidden.");
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    // o opens the post in a new tab: the request is to another site, which the guard aborts.
    const popup = page.waitForEvent("popup");
    await page.keyboard.press("o");
    expect((await popup).url()).toMatch(/news\.ycombinator\.com|about:blank/);
  });
});
