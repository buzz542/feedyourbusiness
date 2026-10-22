import { redirect } from "next/navigation";
import { loadAccount } from "@/server/auth/account";
import { nextStepFor } from "@/server/auth/next-step";

/** `/app` sends the user to the right step: terms, onboarding, billing, settings or Reply. */
export default async function AppHome() {
  const account = await loadAccount();
  if (!account) redirect("/login?next=%2Fapp");
  redirect(nextStepFor(account));
}
