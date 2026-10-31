import type { EmailAllowed } from "@/server/auth/allowlist";

/**
 * The products the daily collect runs for (docs/PLAN.md 7.3 step 1, 12.10). collectable_products()
 * already keeps confirmed, active products of entitled accounts; before launch, only owners on
 * SIGNUP_ALLOWLIST are kept too. An owner whose email cannot be read is skipped (fail closed). The
 * launch switch (M9) removes this filter.
 */
export async function allowlistedProducts(
  rows: readonly { id: string; owner_id: string }[],
  emailOf: (ownerId: string) => Promise<string | null>,
  isAllowed: EmailAllowed,
): Promise<string[]> {
  const kept: string[] = [];
  for (const row of rows) {
    const email = await emailOf(row.owner_id).catch(() => null);
    if (email && isAllowed(email)) kept.push(row.id);
  }
  return kept;
}
