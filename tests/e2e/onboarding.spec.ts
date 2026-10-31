import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./support/test";
import { createConfirmedUser, deleteUserByEmail, magicLinkPath } from "./support/auth";
import { e2eSkipReason } from "./support/guard";

/**
 * Onboarding (docs/PLAN.md 4.3) on localhost with fake services: E2E_FAKE_SERVICES=1 gives an
 * invented draft for any site and reads no real site. The database is the development project.
 */

const EMAIL = "e2e-onboarding@example.test";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });

/** This test user's one product (D9), never another account's. */
async function product(columns: string) {
  const client = admin();
  const { data: users } = await client.auth.admin.listUsers({ perPage: 1000 });
  const owner = users.users.find((u) => u.email === EMAIL)?.id ?? "";
  const { data } = await client.from("products").select(columns).eq("owner_id", owner).single();
  return data as unknown as Record<string, unknown> | null;
}

test.describe("onboarding with fake services", () => {
  const reason = e2eSkipReason(process.env);
  test.skip(reason !== null, `Skipped: ${reason}`);

  test.beforeEach(async ({ page }) => {
    await deleteUserByEmail(EMAIL);
    await createConfirmedUser(EMAIL);
    await page.goto(await magicLinkPath(EMAIL));
    await page.getByLabel("I am 18 or older").check();
    await page.getByLabel(/I agree to the/).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app\/onboarding$/);
  });
  test.afterAll(async () => deleteUserByEmail(EMAIL));

  test("paste a link, see what we found, one click confirms and the database stamps it", async ({
    page,
  }) => {
    await page.getByLabel("Paste your website.").fill("invoicer.example");
    await page.getByRole("button", { name: "Read my product" }).click();
    await expect(page.getByRole("heading", { name: "Here's what we found" })).toBeVisible();
    await expect(page.getByText("Billfast")).toBeVisible();
    await expect(page.getByText(/and \d+ more terms/)).toBeVisible();
    await page.getByRole("button", { name: "Looks right" }).click();
    await expect(page).toHaveURL(/\/app\/billing$/);
    const data = await product("status, confirmed_at");
    expect(data?.status).toBe("active");
    expect(data?.confirmed_at).not.toBeNull();
  });

  test("a description works the same way", async ({ page }) => {
    await page
      .getByLabel("Paste your website.")
      .fill("An app that turns a photo of a receipt into an invoice for freelancers.");
    await page.getByRole("button", { name: "Read my product" }).click();
    await expect(page.getByRole("heading", { name: "Here's what we found" })).toBeVisible();
  });

  test("a platform link shows the refusal and fetches nothing", async ({ page }) => {
    await page.getByLabel("Paste your website.").fill("https://www.reddit.com/r/SaaS");
    await page.getByRole("button", { name: "Read my product" }).click();
    await expect(page.getByText("We can only read your own website.")).toBeVisible();
  });

  test("edits persist, and a sensitive community is refused with a message", async ({ page }) => {
    await page.getByLabel("Paste your website.").fill("invoicer.example");
    await page.getByRole("button", { name: "Read my product" }).click();
    await page.getByText("Change something").click();
    await page.getByLabel(/Communities/).fill("freelance, depression");
    await page.getByRole("button", { name: "Save and confirm" }).click();
    await expect(page.getByText("We don't search r/depression")).toBeVisible();
    await page.getByLabel(/Communities/).fill("freelance");
    await page.getByLabel("Name").fill("Invoicer Pro");
    await page.getByRole("button", { name: "Save and confirm" }).click();
    await expect(page).toHaveURL(/\/app\/billing$/);
    expect(await product("name, subreddits")).toEqual({
      name: "Invoicer Pro",
      subreddits: ["freelance"],
    });
  });

  test("'Not my product?' drafts again into the same product", async ({ page }) => {
    await page.getByLabel("Paste your website.").fill("invoicer.example");
    await page.getByRole("button", { name: "Read my product" }).click();
    const first = await product("id");
    await page.getByRole("link", { name: "Not my product?" }).click();
    await expect(page.getByLabel("Paste your website.")).toHaveValue("https://invoicer.example/");
    await page.getByLabel("Paste your website.").fill("other.example");
    await page.getByRole("button", { name: "Read my product" }).click();
    await expect(page.getByRole("heading", { name: "Here's what we found" })).toBeVisible();
    const again = await product("id, url");
    expect(again?.id).toBe(first?.id);
    expect(again?.url).toBe("https://other.example/");
  });

  test("works at 375px and in dark mode", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByLabel("Paste your website.").fill("invoicer.example");
    await page.getByRole("button", { name: "Read my product" }).click();
    await expect(page.getByRole("button", { name: "Looks right" })).toBeInViewport();
  });
});
