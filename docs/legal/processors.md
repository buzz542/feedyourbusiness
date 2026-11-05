# Processors

Draft, 5 Nov 2026 (PLAN 12.4). The privacy notice lists the same processors from
`src/app/(marketing)/_components/processors.ts`, and a test checks it against
`src/server/net/hosts.ts` and the source registry.

| Processor   | Purpose                           | Where                                      | Transfer mechanism to record | DPA                                               | Status                                                                                       |
| ----------- | --------------------------------- | ------------------------------------------ | ---------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Supabase    | Database, sign-in                 | London (eu-west-2)                         | UK hosting                   | Supabase DPA                                      | Founder to accept and file                                                                   |
| Vercel      | Hosting, functions                | Functions in London (lhr1); edge worldwide | SCCs with the UK addendum    | Vercel DPA                                        | Founder to accept and file                                                                   |
| Anthropic   | Drafting profiles, labeling posts | United States                              | UK IDTA addendum             | In the commercial terms                           | Founder to confirm and file                                                                  |
| Resend      | Email                             | United States                              | UK IDTA addendum             | Resend DPA                                        | Founder to accept and file (F6)                                                              |
| Stripe      | Payments, merchant of record      | United States and EU                       | UK IDTA addendum             | Stripe DPA; Stripe is controller for its MoR role | Founder to confirm (F11)                                                                     |
| Bright Data | Reddit collection                 | Israel (confirm where processing runs)     | UK adequacy for Israel       | Bright Data DPA                                   | Founder (F8). Record their snapshot retention here and in `src/sources/reddit-brightdata.ts` |

X is a data source, not a processor. No processor is switched on in production before its DPA is
signed and its transfer mechanism recorded here.
