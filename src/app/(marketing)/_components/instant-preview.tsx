"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Highlight } from "@/components/ui/highlight";
import { Tag } from "@/components/ui/tag";
import { CATEGORY_LABELS, DISCLOSURE, whereLabel } from "@/lib/reply-tips";
import type { PreviewState } from "../preview-action";

/** "Try it on your product": paste a URL, see real public posts from the last week. */
export function InstantPreview({
  action,
}: {
  action: (state: PreviewState, formData: FormData) => Promise<PreviewState>;
}) {
  const [state, formAction, pending] = useActionState<PreviewState, FormData>(action, {
    status: "idle",
  });
  return (
    <div className="space-y-4">
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="preview-url" className="sr-only">
          Your product&apos;s web address
        </label>
        <input
          id="preview-url"
          name="url"
          type="text"
          inputMode="url"
          required
          maxLength={2048}
          placeholder="yourproduct.com"
          className="min-h-10 flex-1 rounded-[2px] border border-rule-strong bg-paper px-3"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Looking..." : "Try it on your product"}
        </Button>
      </form>
      <div aria-live="polite" className="space-y-3">
        {pending ? (
          <p className="text-sm text-muted">
            Reading your page and searching Hacker News and Bluesky. This takes up to a minute.
          </p>
        ) : null}
        {!pending && state.status === "error" ? (
          <p role="alert" className="text-sm">
            {state.message}
          </p>
        ) : null}
        {!pending && state.status === "done" ? <PreviewResults state={state} /> : null}
      </div>
    </div>
  );
}

function PreviewResults({ state }: { state: Extract<PreviewState, { status: "done" }> }) {
  const { result } = state;
  if (result.posts.length === 0)
    return (
      <p className="text-sm text-muted">
        No matching posts on Hacker News or Bluesky this week for {result.name}. The full feed also
        covers Reddit and X, and runs every morning.
      </p>
    );
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Public posts from the last week that match {result.name}, from Hacker News and Bluesky. The
        full feed adds Reddit and X.
      </p>
      <ul className="space-y-3">
        {result.posts.map((post) => (
          <li key={post.url} className="rounded-[2px] border border-rule p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <Tag>{CATEGORY_LABELS[post.category]}</Tag>
              <span>{whereLabel(post.source, post.community)}</span>
            </div>
            <p className="mt-2">
              <Highlight
                text={post.excerpt}
                start={post.highlight_start}
                end={post.highlight_end}
              />
            </p>
            <p className="mt-2 text-sm text-muted">{post.reason}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                Open the post
              </a>
              <span className="font-medium">{DISCLOSURE}</span>
            </div>
          </li>
        ))}
      </ul>
      {result.theme ? (
        <div className="rounded-[2px] border border-rule bg-sunk p-4">
          <p className="text-sm text-muted">A pattern in these posts</p>
          <p className="mt-1 font-medium">{result.theme.title}</p>
          <p className="mt-1 text-sm">{result.theme.summary}</p>
        </div>
      ) : null}
    </div>
  );
}
