# Personal data breach plan (draft)

1. Contain: rotate the exposed secret (Supabase secret key, Stripe key, Resend key, `CRON_SECRET`), switch off affected sources with their kill switches (`SOURCE_<ID>_ENABLED=false`), and redeploy.
2. Assess within 24 hours: what data, whose, how many people, and the likely harm. Post excerpts are short and public; account emails and billing ids are not.
3. Notify the ICO within 72 hours of becoming aware, unless the breach is unlikely to result in a risk to people. Record the decision either way.
4. Tell affected people without undue delay if the risk to them is high.
5. Tell processors and ask for their logs (Supabase, Vercel, Stripe, Resend, Anthropic, Bright Data).
6. Record the breach, its effects and the fix, and update the DPIA.

Do not rotate `AUTHOR_HASH_PEPPER` unless it was exposed: rotating it orphans the suppression list. If it was exposed, rotate it, re-hash nothing (raw keys are not kept), and treat the suppression list as needing to be rebuilt from open removal requests.
