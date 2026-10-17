"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  draftFromDescriptionAction,
  draftFromUrlAction,
  type DraftActionResult,
} from "@/app/(app)/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { draftMessage } from "./draft-messages";
import { DraftProgress } from "./draft-progress";

const fieldClass =
  "block w-full rounded-[2px] border border-rule-strong bg-paper px-3 py-2 text-base";

/**
 * Onboarding steps 2 and 3 (docs/PLAN.md 4.3): paste the product URL and wait for the draft, or,
 * when the page cannot be read, describe the product instead.
 */
export function UrlStep({ initialUrl, hasDraft }: { initialUrl: string; hasDraft: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"url" | "description">("url");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      let result: DraftActionResult;
      try {
        result =
          mode === "url"
            ? await draftFromUrlAction(url)
            : await draftFromDescriptionAction({ url, description });
      } catch {
        setMessage("Something went wrong while drafting. Try again.");
        return;
      }
      if (result.ok) {
        router.replace("/app/onboarding");
        router.refresh();
        return;
      }
      const explained = draftMessage(result);
      if (!explained) {
        router.refresh();
        return;
      }
      setMessage(explained.text);
      if (explained.offerDescription) setMode("description");
    });
  }

  return (
    <div className="mt-8 space-y-6">
      <form onSubmit={submit} className="space-y-4" noValidate aria-busy={pending}>
        <div className="space-y-1.5">
          <label htmlFor="product-url" className="block text-sm font-medium">
            Your product&apos;s web address
          </label>
          <input
            id="product-url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={pending}
            placeholder="example.com"
            aria-describedby="draft-message"
            className={fieldClass}
          />
        </div>

        {mode === "description" ? (
          <div className="space-y-1.5">
            <label htmlFor="product-description" className="block text-sm font-medium">
              Describe your product
            </label>
            <p id="description-hint" className="text-sm text-muted">
              What it does, who it is for, and which tools people use instead. A few sentences is
              enough.
            </p>
            <textarea
              id="product-description"
              name="description"
              rows={6}
              maxLength={5000}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
              aria-describedby="description-hint draft-message"
              className={fieldClass}
            />
          </div>
        ) : null}

        <p id="draft-message" role="alert" className="min-h-5 text-sm text-negative">
          {message}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {mode === "url" ? "Draft my profile" : "Draft from my description"}
          </Button>
          {mode === "description" ? (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => {
                setMode("url");
                setMessage(null);
              }}
            >
              Try the web address again
            </Button>
          ) : (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => {
                setMode("description");
                setMessage(null);
              }}
            >
              Describe it instead
            </Button>
          )}
          {hasDraft ? (
            <Button href="/app/onboarding" variant="quiet">
              Back to my draft
            </Button>
          ) : null}
        </div>
      </form>

      {pending ? <DraftProgress fromDescription={mode === "description"} /> : null}
    </div>
  );
}
