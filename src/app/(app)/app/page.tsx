import { redirect } from "next/navigation";
import { requireAccount } from "@/server/auth/account";
import { nextStepFor } from "@/server/auth/next-step";

/** `/app` sends the user to the right step: terms, onboarding, billing, settings or Reply. */
export default async function AppHome() {
  const account = await requireAccount("/app");
  redirect(nextStepFor(account));
}
