/**
 * The processors the privacy notice names (docs/PLAN.md 12.4). Every processor host in
 * src/server/net/hosts.ts maps to one of these (tests/compliance/legal.test.ts checks), and the
 * data vendor is named from the Reddit source module. Each needs a signed DPA and a recorded
 * transfer mechanism before it is switched on in production.
 */
export interface Processor {
  name: string;
  purpose: string;
  where: string;
  /** Host suffixes in hosts.ts that belong to this processor. */
  hosts: readonly string[];
}

export const PROCESSORS: readonly Processor[] = [
  {
    name: "Supabase",
    purpose: "database and sign-in",
    where: "London, UK",
    hosts: ["supabase.co"],
  },
  {
    name: "Vercel",
    purpose: "hosting; our server functions run in London",
    where: "London, UK, with a global edge network",
    hosts: [],
  },
  {
    name: "Anthropic",
    purpose: "AI models that label posts, draft your product profile and write weekly summaries",
    where: "United States",
    hosts: ["anthropic.com"],
  },
  { name: "Resend", purpose: "email delivery", where: "United States", hosts: ["resend.com"] },
  {
    name: "Stripe",
    purpose: "payments, as merchant of record",
    where: "United States and the EU",
    hosts: ["stripe.com"],
  },
];
