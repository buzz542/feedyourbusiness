# Processors (draft)

Each processor needs a signed DPA and a recorded transfer mechanism before it is used in production (docs/PLAN.md 12.4). Fill in the dates as each is done.

| Processor   | Purpose                           | Location                      | DPA                                                              | Transfer mechanism                                    | Signed on |
| ----------- | --------------------------------- | ----------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- | --------- |
| Supabase    | Database, sign-in                 | London (eu-west-2)            | Supabase DPA                                                     | UK hosting                                            |           |
| Vercel      | Hosting, functions in London      | London, global edge           | Vercel DPA                                                       | UK IDTA or adequacy as applicable                     |           |
| Anthropic   | Classification, drafts, synthesis | United States                 | In commercial terms                                              | UK IDTA / Addendum                                    |           |
| Resend      | Email                             | United States                 | Resend DPA                                                       | UK IDTA / Addendum                                    |           |
| Stripe      | Payments, merchant of record      | United States and EU          | Stripe DPA; Stripe is controller for its merchant of record role | UK IDTA / Addendum                                    |           |
| Bright Data | Reddit data collection            | Israel and its infrastructure | Bright Data DPA (F8)                                             | Israel has UK adequacy; confirm where processing runs |           |

Bright Data snapshot retention: to be confirmed in writing (F8) and recorded in `src/sources/reddit.ts` (`vendor.snapshotRetention`). Reddit stays off on every deployment until it is.

X is a data source, not a processor.
