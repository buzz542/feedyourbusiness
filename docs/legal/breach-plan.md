# Personal data breach plan

Draft, 5 Nov 2026. The UK GDPR gives 72 hours from becoming aware of a reportable breach to tell
the ICO.

## First hour

1. Contain it: rotate the leaked secret (Supabase secret key, Stripe key, Resend key,
   `AUTHOR_HASH_PEPPER` only if it leaked, since rotating it orphans the suppression list), turn
   off the affected source with `SOURCE_<ID>_ENABLED=false`, or pause the Vercel project.
2. Write down what happened, when it was found, and by whom, in a private log.

## Within 24 hours

3. Work out what data, whose, and how many people. Post tables hold excerpts, links and keyed
   hashes, never usernames; accounts hold emails.
4. Decide if it is likely to result in a risk to people's rights. If yes, it is reportable.

## Within 72 hours

5. Report to the ICO if reportable (ico.org.uk, breach reporting).
6. If the risk to people is high, tell them directly, in plain words, with what they can do.
7. Tell affected processors and ask for their logs.

## Afterwards

8. Fix the cause, add a test that would have caught it, and record the breach and the decisions in
   the log, reported or not.
