# Classifier eval

`npm run eval:classifier` scores the classifier against posts you labeled by hand (docs/PLAN.md 8.6).
It calls the live Anthropic API, so it runs by hand only, never in CI.

1. Put your product's profile in `eval/profile.json` (name, one-liner, audience, competitors), the
   same fields onboarding drafts.
2. Label 100 posts in `eval/labeled.jsonl`, one JSON object per line, in the format of
   `eval/sample.jsonl`: `id`, `source`, `community`, `excerpt` (at most 280 characters), `relevant`
   (true or false) and `category` (or null). Both files stay out of git: they hold real posts.
3. Run `EVAL_LIVE=1 ANTHROPIC_API_KEY=... npm run eval:classifier`. It prints precision and recall
   at the default threshold (60). The target is precision 0.80 or better.
