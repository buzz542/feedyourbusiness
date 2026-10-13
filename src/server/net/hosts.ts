/**
 * Hosts that appear in our code but are NOT data sources.
 *
 * Data sources live in src/sources/registry.ts and are the only hosts safeFetch will call. The
 * hosts below are reached only through the vendors' official SDKs (processors under a DPA), or
 * are our own domains, or are standards namespaces that appear as plain strings. The static hosts
 * gate treats a URL literal on any other host as a violation.
 *
 * Adding a host here changes the processor list in the privacy notice and needs founder approval.
 */

/** Processors. Each needs a signed DPA and a recorded transfer mechanism before launch. */
export const PROCESSOR_HOSTS = [
  "api.stripe.com",
  "checkout.stripe.com",
  "billing.stripe.com",
  "api.resend.com",
  "api.anthropic.com",
  // Supabase project API and auth. The project ref is not a secret.
  "hoqbflkszzoojdswbrgy.supabase.co",
] as const;

/** Our own domains. The brief lists askedfor.app as primary. Not yet purchased. */
export const OWN_HOSTS = [
  "askedfor.app",
  "www.askedfor.app",
  "askedfor.dev",
  "tryaskedfor.com",
  "localhost",
] as const;

/** Namespaces and specs that show up as string literals but are never requested. */
export const STANDARDS_HOSTS = ["www.w3.org", "schema.org", "json-schema.org"] as const;
