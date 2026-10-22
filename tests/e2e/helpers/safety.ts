/**
 * The E2E helpers create and delete auth users with the admin API. They run only against the
 * development project and only for an address on a reserved test domain, so a production key or a
 * real email in the env can never touch a real account.
 */
export const PRODUCTION_PROJECT_REF = "hoqbflkszzoojdswbrgy";
const RESERVED = /@(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid))$/i;

export function assertSafeE2ETarget(supabaseUrl: string | undefined, email: string): void {
  if (!supabaseUrl || supabaseUrl.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error("E2E refuses to run against the production Supabase project");
  }
  if (!RESERVED.test(email.trim())) {
    throw new Error("E2E_EMAIL must be on a reserved test domain (example.com, *.test)");
  }
}
