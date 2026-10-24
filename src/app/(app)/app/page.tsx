import { redirect } from "next/navigation";
import { loadAccount } from "@/server/auth/account";
import { nextStepFor } from "@/server/auth/next-step";
import { requireAppUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** /app has no screen of its own: it sends you to the step you are on (docs/PLAN.md 4.2). */
export default async function AppIndex() {
  const user = await requireAppUser("/app", { beforeTerms: true });
  redirect(nextStepFor(await loadAccount(user.id)));
}
