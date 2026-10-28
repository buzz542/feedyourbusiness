"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { draftAction, type DraftState } from "./actions";

/** A single request cannot report its steps, so the line moves on with time, as the work does. */
const PROGRESS: readonly (readonly [number, string])[] = [
  [0, "Reading your page..."],
  [6, "Drafting your search terms and competitors..."],
  [45, "Still drafting. This can take up to 2 minutes."],
];

const NEEDS_DESCRIPTION = {
  fetch_failed:
    "We could not read that page. Describe your product instead and we will draft from that.",
  platform_page:
    "That address is on a platform AskedFor never fetches pages from. Describe your product instead.",
  too_little_text:
    "That page has almost no text we can read, often because scripts draw it. Describe your product instead.",
} as const;

function message(state: DraftState): string {
  switch (state.kind) {
    case "idle":
      return "";
    case "needs_description":
      return NEEDS_DESCRIPTION[state.reason];
    case "invalid_url":
      return "Enter your product's web address, like yourproduct.com.";
    case "invalid_description":
      return "Describe your product in 40 to 5,000 characters.";
    case "already_confirmed":
      return "Your product is already set up. You can change it in Settings.";
    case "busy":
      return "We cannot draft right now. Try again later.";
    case "timed_out":
      return "That took too long. Try again, or describe your product instead.";
    case "failed":
      return "Something went wrong. Try again.";
  }
}

function Progress() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const line = PROGRESS.filter(([at]) => seconds >= at).at(-1)![1];
  return <>{line}</>;
}

export function UrlStep({ initialUrl }: { initialUrl: string }) {
  const [state, submit, pending] = useActionState<DraftState, FormData>(draftAction, {
    kind: "idle",
    url: initialUrl,
  });
  const [describing, setDescribing] = useState(false);
  const showDescription = describing || state.kind === "needs_description";

  return (
    <form action={submit} className="mt-8 max-w-prose space-y-6">
      <div className="space-y-2">
        <label htmlFor="url" className="block font-medium">
          Your product&apos;s web address
        </label>
        <input
          id="url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          required
          defaultValue={state.url}
          placeholder="yourproduct.com"
          className="w-full rounded-[2px] border border-rule bg-paper px-3 py-2"
        />
        <p className="text-sm text-muted">
          We read this one page once to draft your setup. You can edit everything after.
        </p>
      </div>

      {showDescription ? (
        <div className="space-y-2">
          <label htmlFor="description" className="block font-medium">
            Describe your product
          </label>
          <textarea
            id="description"
            name="description"
            required
            minLength={40}
            maxLength={5000}
            rows={6}
            className="w-full rounded-[2px] border border-rule bg-paper px-3 py-2"
          />
          <p className="text-sm text-muted">
            What it does, who it is for, and what people use instead.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {showDescription ? "Draft from my description" : "Draft my setup"}
        </Button>
        {showDescription ? null : (
          <Button variant="quiet" onClick={() => setDescribing(true)} disabled={pending}>
            Describe it instead
          </Button>
        )}
      </div>

      <p role="status" aria-live="polite" className="min-h-6 text-sm">
        {pending ? <Progress /> : message(state)}
      </p>
    </form>
  );
}
