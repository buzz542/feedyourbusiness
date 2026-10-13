import { beforeEach, describe, expect, it } from "vitest";
import { BillingError, createCheckoutSession } from "./checkout";
import { FakeStripe, TEST_CONFIG } from "./fakes";

let stripe: FakeStripe;
const user = { id: "user-1", email: "maker@example.test" };

const create = (overrides: Partial<Parameters<typeof createCheckoutSession>[0]> = {}) =>
  createCheckoutSession({ stripe, config: TEST_CONFIG, user, customerId: null, ...overrides });

beforeEach(() => {
  stripe = new FakeStripe();
});

describe("createCheckoutSession", () => {
  it("returns the Stripe URL", async () => {
    expect(await create()).toEqual({ url: "https://checkout.stripe.test/session_1" });
  });

  it("builds a card-required subscription with a 7 day trial that cancels if no card is left", async () => {
    await create();
    const params = stripe.checkoutCalls[0]!;

    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([{ price: "price_abc123", quantity: 1 }]);
    expect(params.payment_method_collection).toBe("always");
    expect(params.subscription_data?.trial_period_days).toBe(7);
    expect(params.subscription_data?.trial_settings?.end_behavior?.missing_payment_method).toBe(
      "cancel",
    );
  });

  it("shows the price, renewal and cancellation terms on the payment page", async () => {
    await create();
    const submit = stripe.checkoutCalls[0]!.custom_text?.submit;
    const message = submit && typeof submit === "object" ? (submit.message ?? "") : "";

    expect(message).toContain("$29.00");
    expect(message).toContain("every month until you cancel");
    expect(message).toContain("cancel online from Settings in two clicks");
  });

  it("ties the session and the subscription to our user, so the webhook can find them", async () => {
    await create();
    const params = stripe.checkoutCalls[0]!;

    expect(params.client_reference_id).toBe("user-1");
    expect(params.subscription_data?.metadata).toEqual({ user_id: "user-1" });
  });

  it("turns Managed Payments on, and leaves it off only when configured so", async () => {
    await create();
    expect(stripe.checkoutCalls[0]!.managed_payments).toEqual({ enabled: true });

    await create({ config: { ...TEST_CONFIG, managedPayments: false } });
    expect(stripe.checkoutCalls[1]).not.toHaveProperty("managed_payments");
  });

  it("reuses an existing Stripe customer instead of creating a duplicate", async () => {
    await create({ customerId: "cus_existing" });
    const params = stripe.checkoutCalls[0]!;

    expect(params.customer).toBe("cus_existing");
    expect(params).not.toHaveProperty("customer_email");
  });

  it("prefills the email for a new customer", async () => {
    await create();
    expect(stripe.checkoutCalls[0]!.customer_email).toBe("maker@example.test");
  });

  it("returns to our own site and disallows promotion codes", async () => {
    await create();
    const params = stripe.checkoutCalls[0]!;

    expect(params.success_url?.startsWith("https://app.example.test/")).toBe(true);
    expect(params.cancel_url?.startsWith("https://app.example.test/")).toBe(true);
    expect(params.allow_promotion_codes).toBe(false);
  });

  it.each([
    ["inactive", { active: false }],
    ["one-off", { interval: null }],
    ["without an amount", { unitAmount: null }],
  ])("refuses a price that is %s", async (_label, patch) => {
    stripe.price = { ...stripe.price, ...patch };
    await expect(create()).rejects.toBeInstanceOf(BillingError);
    expect(stripe.checkoutCalls).toHaveLength(0);
  });

  it("fails loudly if Stripe returns no URL", async () => {
    stripe.checkoutUrl = null;
    await expect(create()).rejects.toMatchObject({ code: "no_checkout_url" });
  });
});
