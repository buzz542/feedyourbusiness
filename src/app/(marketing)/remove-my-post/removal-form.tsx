"use client";

import { useState } from "react";

type Result = { ok: true } | { ok: false; error: "invalid" | "rate_limited" | "unavailable" };

const ERRORS: Record<string, string> = {
  invalid: "Please fill in every field, check the box, and give a valid email address.",
  rate_limited: "You have sent several requests today. Please try again tomorrow.",
  unavailable: "We could not take your request just now. Please try again in a minute.",
};

/** The removal form (docs/PLAN.md 4.8): one option per source the page passes, as [value, label]. */
export function RemovalForm({
  submit,
  sources,
}: {
  submit: (form: unknown) => Promise<Result>;
  sources: readonly (readonly [string, string])[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const result = await submit({
      source: data.get("source"),
      linkOrHandle: data.get("linkOrHandle"),
      contactEmail: data.get("contactEmail"),
      details: data.get("details") ?? "",
      confirm: data.get("confirm") === "on",
    }).catch(() => ({ ok: false, error: "unavailable" }) as Result);
    setBusy(false);
    if (result.ok) setDone(true);
    else setError(ERRORS[result.error] ?? ERRORS.unavailable!);
  }

  if (done)
    return (
      <p role="status" className="rounded-[2px] border border-rule p-4">
        We have your request. We will email you when it is done.
      </p>
    );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Platform
        <select
          name="source"
          required
          className="rounded-[2px] border border-rule bg-paper px-2 py-1.5"
        >
          {sources.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Link to the post, or your username
        <input
          name="linkOrHandle"
          required
          maxLength={500}
          className="rounded-[2px] border border-rule bg-paper px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Your email, so we can tell you when it is done
        <input
          name="contactEmail"
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          className="rounded-[2px] border border-rule bg-paper px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Anything else we should know (optional)
        <textarea
          name="details"
          maxLength={1000}
          rows={3}
          className="rounded-[2px] border border-rule bg-paper px-2 py-1.5"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" required className="mt-1" />
        <span>I wrote this post, or this is my username.</span>
      </label>
      <button
        type="submit"
        disabled={busy}
        className="self-start rounded-[2px] bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
      >
        Send request
      </button>
      <p role="status" aria-live="polite" className="text-sm text-muted">
        {error}
      </p>
    </form>
  );
}
