import "server-only";
import { getLlm } from "@/server/llm/deps";
import { fetchOwnSite } from "@/server/net/own-site";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { fakeOnboardingServices, fakeServicesEnabled } from "./e2e-services";
import type { OnboardingStore } from "./ports";
import { createOnboarding, type Onboarding } from "./service";
import { createSupabaseOnboardingStore } from "./supabase-store";

/** The signed-in user's store: their own client, so RLS applies to every statement. */
export async function getOnboardingStore(): Promise<OnboardingStore> {
  return createSupabaseOnboardingStore(await createSupabaseServerClient());
}

export async function getOnboarding(): Promise<Onboarding> {
  const store = await getOnboardingStore();
  const services = fakeServicesEnabled(process.env)
    ? fakeOnboardingServices()
    : { llm: getLlm(), fetchSite: fetchOwnSite };
  return createOnboarding({ store, ...services });
}
