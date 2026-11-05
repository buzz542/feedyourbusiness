import { nextStepFor, type AccountState } from "./next-step";

/**
 * Entitlement on every app data page (docs/PLAN.md 10.4), with the welcome step after Checkout
 * (7.3) run first. Pure, with ports, so the order and every status are tested
 * (`app-gate.test.ts`); `entitled.ts` wires it to Supabase and Stripe.
 */

export interface GateDeps {
  /** The signed-in, allowed user who accepted the terms. In the app it redirects otherwise. */
  requireUser(path: string): Promise<{ id: string }>;
  loadAccount(userId: string): Promise<AccountState>;
  /**
   * Confirm a just-completed Checkout Session and apply its billing patch (7.3). Only "pending"
   * (paid, but Stripe has not given us the subscription yet) is worth waiting for; every other
   * answer means the profile already holds the truth.
   */
  applyWelcome(userId: string, sessionId: string | undefined): Promise<string>;
  /** Start the first run once (dedupe keys); only called for an entitled account. */
  startFirstRun(userId: string): Promise<void>;
  logError(message: string): void;
}

export type GateOutcome =
  | { kind: "render"; userId: string }
  | { kind: "redirect"; to: string }
  /** Back from Checkout, but the payment could not be confirmed yet: never send them to billing. */
  | { kind: "confirming" };

export interface GateInput {
  path: string;
  /** Present only on the Checkout return URL of the Reply tab. */
  welcome?: { sessionId: string | undefined };
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : "UnknownError");

export async function gateAppPage(deps: GateDeps, input: GateInput): Promise<GateOutcome> {
  const user = await deps.requireUser(input.path);

  // True when this user paid but we could not see the subscription yet.
  let unconfirmed = false;
  if (input.welcome) {
    try {
      unconfirmed = (await deps.applyWelcome(user.id, input.welcome.sessionId)) === "pending";
    } catch (error) {
      unconfirmed = true;
      deps.logError(`[billing] welcome failed: ${errorName(error)}`);
    }
  }

  const step = nextStepFor(await deps.loadAccount(user.id));
  if (step !== "/app/reply") {
    // A user back from a real checkout who is not entitled yet would otherwise be offered a
    // second one; the webhook settles it within seconds, and a refresh runs the step again.
    if (unconfirmed && step === "/app/billing") return { kind: "confirming" };
    return { kind: "redirect", to: step };
  }

  if (input.welcome) {
    await deps.startFirstRun(user.id);
    // Drop session_id from the address, so a reload or a bookmark never replays the step.
    return { kind: "redirect", to: "/app/reply" };
  }
  return { kind: "render", userId: user.id };
}
