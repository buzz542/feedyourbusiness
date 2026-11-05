/**
 * The processors the privacy notice names (docs/PLAN.md 12.4). A test checks that every processor
 * host in src/server/net/hosts.ts belongs to one of them, and the notice also names every collect
 * source and every vendor in the registry. The vendor's own host is never written here: it may
 * appear only in src/sources/reddit*.ts (2.1.9).
 */
export interface Processor {
  name: string;
  purpose: string;
  where: string;
  transfer: string;
  hosts: readonly string[];
}

export const PROCESSORS: readonly Processor[] = [
  {
    name: "Supabase",
    purpose: "our database and sign-in",
    where: "London, United Kingdom",
    transfer: "data stays in the United Kingdom",
    hosts: ["hoqbflkszzoojdswbrgy.supabase.co"],
  },
  {
    name: "Vercel",
    purpose: "hosting and running the app",
    where: "the app runs in London; pages are served worldwide",
    transfer: "standard contractual clauses with the UK addendum",
    hosts: [],
  },
  {
    name: "Anthropic",
    purpose: "drafting your product profile and labeling posts",
    where: "United States",
    transfer: "the UK international data transfer addendum",
    hosts: ["api.anthropic.com"],
  },
  {
    name: "Resend",
    purpose: "sending email",
    where: "United States",
    transfer: "the UK international data transfer addendum",
    hosts: ["api.resend.com"],
  },
  {
    name: "Stripe",
    purpose: "taking payment; Stripe sells the subscription as merchant of record",
    where: "United States and the European Union",
    transfer: "the UK international data transfer addendum",
    hosts: ["api.stripe.com", "checkout.stripe.com", "billing.stripe.com"],
  },
  {
    name: "Bright Data",
    purpose: "collecting public Reddit pages for us",
    where: "Israel",
    transfer: "the UK's adequacy decision for Israel",
    hosts: [],
  },
];
