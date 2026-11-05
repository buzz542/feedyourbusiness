import Stripe from "stripe";
import { expect, test } from "./support/test";
import { E2E_BILLING_EMAIL } from "../../playwright.config";
import { adminClient, createConfirmedUser, deleteUserByEmail, magicLinkPath } from "./support/auth";
import { billingE2eSkipReason } from "./support/guard";

/**
 * Billing in Stripe test mode on localhost (docs/PLAN.md 10.3, 10.9). The browser never loads
 * Stripe's hosted page: the test asserts the redirect and its parameters, completes the
 * subscription with the test-mode API, and posts a correctly signed event to the local webhook.
 * The founder clicks through real test-mode Checkout once (F14).
 */

const EMAIL = E2E_BILLING_EMAIL;

function stripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
}

async function userId(): Promise<string> {
  const { data } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
  const id = data.users.find((u) => u.email === EMAIL)?.id;
  if (!id) throw new Error("billing E2E user not found");
  return id;
}

/** Post a subscription event to our own webhook, signed with the endpoint's secret. */
async function postSignedEvent(baseURL: string, sub: Stripe.Subscription, type: string) {
  const payload = JSON.stringify({
    id: `evt_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "event",
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: sub },
  });
  const signature = stripe().webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  });
  return fetch(`${baseURL}/api/billing/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body: payload,
  });
}

test.describe("billing in Stripe test mode", () => {
  const reason = billingE2eSkipReason(process.env);
  test.skip(reason !== null, `Skipped: ${reason}`);

  let customerId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await deleteUserByEmail(EMAIL);
    await createConfirmedUser(EMAIL);
    await page.goto(await magicLinkPath(EMAIL));
    await page.getByLabel("I am 18 or older").check();
    await page.getByLabel(/I agree to the/).check();
    await page.getByRole("button", { name: "Continue" }).click();
    // A confirmed product, as onboarding leaves it (the database stamps confirmed_at).
    const { error } = await adminClient()
      .from("products")
      .insert({ owner_id: await userId(), name: "Invoicer", status: "active" });
    if (error) throw new Error(`product insert failed: ${error.code}`);
  });

  test.afterEach(async () => {
    if (customerId) await stripe().customers.del(customerId);
    customerId = null;
    await deleteUserByEmail(EMAIL);
  });

  test("checkout redirects with the right parameters; a signed event entitles; cancel and resume in two clicks", async ({
    page,
    baseURL,
  }) => {
    const id = await userId();

    // 1. The billing page, the consent box, then the redirect to Stripe Checkout.
    await page.goto("/app/billing");
    await expect(page.getByText("tax included where it applies")).toBeVisible();
    const start = page.getByRole("button", { name: "Start your free trial" });
    await expect(start).toBeDisabled();
    await page.getByRole("checkbox").check();
    const toStripe = page.waitForRequest((r) => r.url().startsWith("https://checkout.stripe.com/"));
    await start.click();
    const checkoutUrl = (await toStripe).url();
    const sessionId = /cs_test_[A-Za-z0-9]+/.exec(checkoutUrl)?.[0];
    expect(sessionId).toBeTruthy();
    const session = await stripe().checkout.sessions.retrieve(sessionId!);
    expect(session.mode).toBe("subscription");
    expect(session.client_reference_id).toBe(id);
    expect(session.payment_method_collection).toBe("always");
    expect(session.success_url).toContain("/app/reply?welcome=1&session_id=");
    expect(session.cancel_url).toContain("/app/billing?checkout=canceled");
    const items = await stripe().checkout.sessions.listLineItems(sessionId!);
    expect(items.data[0]?.price?.id).toBe(process.env.STRIPE_PRICE_ID);

    // An unfinished Checkout Session never entitles anyone through the welcome step.
    await page.goto(`/app/reply?welcome=1&session_id=${sessionId}`);
    await expect(page).toHaveURL(/\/app\/billing/);

    // 2. Complete the subscription with the test API, as Checkout would, and tell our webhook.
    const customer = await stripe().customers.create({
      email: EMAIL,
      payment_method: "pm_card_visa",
      invoice_settings: { default_payment_method: "pm_card_visa" },
    });
    customerId = customer.id;
    const sub = await stripe().subscriptions.create({
      customer: customer.id,
      items: [{ price: process.env.STRIPE_PRICE_ID ?? "" }],
      trial_period_days: 7,
      metadata: { user_id: id, service_consent_at: new Date().toISOString() },
    });
    const response = await postSignedEvent(baseURL!, sub, "customer.subscription.created");
    expect(response.status).toBe(200);

    await page.goto("/app/reply");
    await expect(page).toHaveURL(/\/app\/reply$/);
    const { data: profile } = await adminClient()
      .from("profiles")
      .select("subscription_status, service_consent_at")
      .eq("id", id)
      .single();
    expect(profile?.subscription_status).toBe("trialing");
    expect(profile?.service_consent_at).not.toBeNull();

    // 3. Settings: the plan in plain words, then cancel in two clicks, then resume.
    await page.goto("/app/settings");
    await expect(page.getByText(/^Trial ends /)).toBeVisible();
    await page.getByRole("button", { name: "Cancel subscription" }).click();
    await expect(page.getByText(/You keep access until/)).toBeVisible();
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByRole("status")).toContainText("Canceled.");
    expect((await stripe().subscriptions.retrieve(sub.id)).cancel_at_period_end).toBe(true);
    await page.getByRole("button", { name: "Resume subscription" }).click();
    await expect(page.getByRole("status")).toContainText("Resumed.");
    expect((await stripe().subscriptions.retrieve(sub.id)).cancel_at_period_end).toBe(false);

    // 4. A second checkout is refused while the subscription is live.
    await page.goto("/app/billing");
    await expect(page).toHaveURL(/\/app\/reply$/);
  });

  test("export has no excerpts; deleting the account cancels at once and removes every owned row", async ({
    page,
  }) => {
    const id = await userId();
    const customer = await stripe().customers.create({
      email: EMAIL,
      payment_method: "pm_card_visa",
      invoice_settings: { default_payment_method: "pm_card_visa" },
    });
    customerId = customer.id;
    const sub = await stripe().subscriptions.create({
      customer: customer.id,
      items: [{ price: process.env.STRIPE_PRICE_ID ?? "" }],
      trial_period_days: 7,
      metadata: { user_id: id },
    });
    await adminClient().rpc("apply_billing_patch", {
      p_user_id: id,
      p_event_at: new Date().toISOString(),
      p_patch: {
        subscription_status: "trialing",
        stripe_customer_id: customer.id,
        stripe_subscription_id: sub.id,
      },
    });

    // The export: the user's own data, no excerpts.
    const exported = await page.request.get("/api/export");
    expect(exported.status()).toBe(200);
    const body = (await exported.json()) as { product: { name: string }; feed: unknown[] };
    expect(body.product.name).toBe("Invoicer");
    expect(JSON.stringify(body)).not.toContain("excerpt");

    // Delete: typed confirmation, then the subscription is canceled at once.
    await page.goto("/app/settings");
    const button = page.getByRole("button", { name: "Delete my account" });
    await expect(button).toBeDisabled();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await button.click();
    await expect(page).toHaveURL(/\/\?account=deleted$/);
    expect((await stripe().subscriptions.retrieve(sub.id)).status).toBe("canceled");
    const admin = adminClient();
    expect((await admin.auth.admin.getUserById(id)).data.user ?? null).toBeNull();
    for (const [table, column] of [
      ["profiles", "id"],
      ["products", "owner_id"],
    ] as const) {
      const { count } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, id);
      expect(count).toBe(0);
    }
    const { count: audits } = await admin
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("action", "account_deleted")
      .eq("target", id);
    expect(audits).toBe(1);
  });

  test("a past_due account is sent to Settings and sees the banner", async ({ page }) => {
    const id = await userId();
    const { error } = await adminClient().rpc("apply_billing_patch", {
      p_user_id: id,
      p_event_at: new Date().toISOString(),
      p_patch: { subscription_status: "past_due", stripe_customer_id: "cus_e2e_none" },
    });
    if (error) throw new Error(`billing patch failed: ${error.code}`);
    await page.goto("/app/reply");
    await expect(page).toHaveURL(/\/app\/settings$/);
    await expect(page.getByRole("alert")).toContainText("Update your card");
  });
});
