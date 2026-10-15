import { redirect } from "next/navigation";
import { loadAppState } from "@/server/auth/app-state";
import { nextStepFor } from "@/server/auth/next-step";
import { requireUser } from "@/server/auth/session";

/** /app sends each person to the right step: confirmations, onboarding, billing or Reply. */
export default async function AppIndex() {
  const user = await requireUser("/app");
  redirect(nextStepFor(await loadAppState(user.id)).path);
}
