"use client";

import { useRouter } from "next/navigation";
import { useReducer, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { confirmProfileAction, saveProfileAction } from "@/app/(app)/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Tag } from "@/components/ui/tag";
import type { ProfileErrors, ProfileResult } from "@/server/onboarding/profile";
import {
  fromDraft,
  MAX_SUBREDDITS,
  MAX_TERMS,
  profileReducer,
  subredditProblem,
  termProblem,
  toProfileInput,
  type DraftView,
  type TextField,
} from "./profile-state";

const fieldClass =
  "block w-full rounded-[2px] border border-rule-strong bg-paper px-3 py-2 text-base";

const INTENT_LABELS = {
  problem: "Problem",
  category: "Category",
  alternative: "Alternative",
  competitor: "Competitor",
} as const;

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint: boolean, error: string | undefined) =>
  [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-rule pt-6">
      <div>
        <h2 className="font-serif text-xl tracking-tight">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Onboarding steps 4 and 5 (docs/PLAN.md 4.3): every field of the draft is editable, then confirm.
 * The page remounts this form after each save, so it always starts from what is stored.
 */
export function ReviewForm({ draft, saved }: { draft: DraftView; saved: boolean }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(profileReducer, draft, fromDraft);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [newTerm, setNewTerm] = useState("");
  const [termError, setTermError] = useState<string | null>(null);
  const [newSub, setNewSub] = useState("");
  const [subError, setSubError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const text = (field: TextField) => ({
    value: state[field],
    onChange: (e: { target: { value: string } }) =>
      dispatch({ type: "field", field, value: e.target.value }),
  });

  function addTerm() {
    const problem = termProblem(state.terms, newTerm);
    setTermError(problem);
    if (problem) return;
    dispatch({ type: "addTerm", term: newTerm });
    setNewTerm("");
  }

  function addSubreddit() {
    const problem = subredditProblem(state.subreddits, newSub);
    setSubError(problem);
    if (problem) return;
    dispatch({ type: "addSubreddit", name: newSub });
    setNewSub("");
  }

  const onEnter = (add: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  };

  function run(kind: "save" | "confirm") {
    startTransition(async () => {
      let result: ProfileResult;
      try {
        const input = toProfileInput(state);
        result =
          kind === "save" ? await saveProfileAction(input) : await confirmProfileAction(input);
      } catch {
        setErrors({ form: "Something went wrong. Your changes were not saved. Try again." });
        return;
      }
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setErrors({});
      router.replace(kind === "save" ? "/app/onboarding?saved=1" : "/app");
      router.refresh();
    });
  }

  const errorCount = Object.keys(errors).length;

  return (
    <form
      className="mt-8 space-y-8"
      noValidate
      aria-busy={pending}
      // Confirming starts collection, so only the Confirm button does it: Enter in a field submits
      // nothing (there is no submit button, and this guard covers any browser that submits anyway).
      onSubmit={(event) => event.preventDefault()}
    >
      <div aria-live="polite" className="min-h-5 text-sm">
        {errorCount > 0 ? (
          <p role="alert" className="text-negative">
            {errors.form ?? "Some fields need a change before this can be saved."}
          </p>
        ) : saved && !pending ? (
          <p role="status" className="text-muted">
            Changes saved.
          </p>
        ) : null}
      </div>

      <Section title="Your product">
        <Field id="name" label="Name" error={errors.name}>
          <input
            id="name"
            maxLength={120}
            {...text("name")}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy("name", false, errors.name)}
            className={fieldClass}
          />
        </Field>
        <Field
          id="one_liner"
          label="One-line summary"
          hint="What it does, in one plain sentence."
          error={errors.one_liner}
        >
          <input
            id="one_liner"
            maxLength={160}
            {...text("one_liner")}
            aria-invalid={errors.one_liner ? true : undefined}
            aria-describedby={describedBy("one_liner", true, errors.one_liner)}
            className={fieldClass}
          />
        </Field>
        <Field id="description" label="Description" error={errors.description}>
          <textarea
            id="description"
            rows={4}
            maxLength={2000}
            {...text("description")}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={describedBy("description", false, errors.description)}
            className={fieldClass}
          />
        </Field>
        <Field id="audience" label="Who it is for" error={errors.audience}>
          <textarea
            id="audience"
            rows={2}
            maxLength={1000}
            {...text("audience")}
            aria-invalid={errors.audience ? true : undefined}
            aria-describedby={describedBy("audience", false, errors.audience)}
            className={fieldClass}
          />
        </Field>
      </Section>

      <Section
        title="Search terms"
        hint="Phrases people write when they need what you built. AskedFor searches for these."
      >
        <ul className="flex flex-wrap gap-2" aria-label="Search terms">
          {state.terms.map((t, i) => (
            <li key={t.term}>
              <Chip className="pr-1">
                <span>{t.term}</span>
                <Tag className="ml-1">{INTENT_LABELS[t.intent]}</Tag>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "removeTerm", index: i })}
                  aria-label={`Remove "${t.term}"`}
                  className="ml-1 inline-flex size-7 items-center justify-center rounded-[2px] text-muted hover:text-ink"
                >
                  <span aria-hidden="true">{"×"}</span>
                </button>
              </Chip>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          {state.terms.length} of {MAX_TERMS} terms
        </p>
        <div className="space-y-1.5">
          <label htmlFor="new-term" className="block text-sm font-medium">
            Add a term
          </label>
          <div className="flex gap-2">
            <input
              id="new-term"
              value={newTerm}
              maxLength={60}
              onChange={(e) => setNewTerm(e.target.value)}
              onKeyDown={onEnter(addTerm)}
              aria-invalid={termError ? true : undefined}
              aria-describedby={termError ? "new-term-error" : undefined}
              className={fieldClass}
            />
            <Button variant="secondary" onClick={addTerm}>
              Add
            </Button>
          </div>
          <p id="new-term-error" className="min-h-5 text-sm text-negative">
            {termError ?? errors.terms}
          </p>
        </div>
      </Section>

      <Section
        title="Competitors"
        hint="Tools your customers compare you with. Other names are spellings people use, like an old name or an abbreviation."
      >
        {errors.competitors ? <p className="text-sm text-negative">{errors.competitors}</p> : null}
        <ul className="space-y-3">
          {state.competitors.map((c, i) => {
            const nameError = errors[`competitors.${i}.name`];
            const domainError = errors[`competitors.${i}.domain`];
            const aliasError = errors[`competitors.${i}.aliases`];
            return (
              <Card as="li" key={c.key} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Field id={`competitor-${c.key}-name`} label="Competitor name" error={nameError}>
                  <input
                    id={`competitor-${c.key}-name`}
                    value={c.name}
                    maxLength={80}
                    onChange={(e) =>
                      dispatch({
                        type: "editCompetitor",
                        key: c.key,
                        patch: { name: e.target.value },
                      })
                    }
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={describedBy(`competitor-${c.key}-name`, false, nameError)}
                    className={fieldClass}
                  />
                </Field>
                <Field
                  id={`competitor-${c.key}-domain`}
                  label="Domain (optional)"
                  error={domainError}
                >
                  <input
                    id={`competitor-${c.key}-domain`}
                    value={c.domain}
                    inputMode="url"
                    spellCheck={false}
                    onChange={(e) =>
                      dispatch({
                        type: "editCompetitor",
                        key: c.key,
                        patch: { domain: e.target.value },
                      })
                    }
                    aria-invalid={domainError ? true : undefined}
                    aria-describedby={describedBy(`competitor-${c.key}-domain`, false, domainError)}
                    className={fieldClass}
                  />
                </Field>
                <Field
                  id={`competitor-${c.key}-aliases`}
                  label="Other names (optional)"
                  error={aliasError}
                >
                  <input
                    id={`competitor-${c.key}-aliases`}
                    value={c.aliases}
                    onChange={(e) =>
                      dispatch({
                        type: "editCompetitor",
                        key: c.key,
                        patch: { aliases: e.target.value },
                      })
                    }
                    aria-invalid={aliasError ? true : undefined}
                    aria-describedby={describedBy(`competitor-${c.key}-aliases`, false, aliasError)}
                    className={fieldClass}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    variant="quiet"
                    onClick={() => dispatch({ type: "removeCompetitor", key: c.key })}
                    aria-label={`Remove ${c.name || "this competitor"}`}
                  >
                    Remove
                  </Button>
                </div>
              </Card>
            );
          })}
        </ul>
        <Button variant="secondary" onClick={() => dispatch({ type: "addCompetitor" })}>
          Add a competitor
        </Button>
      </Section>

      <Section
        title="Subreddits"
        hint="Communities where your audience asks for help. Used for Reddit search links and to steer Reddit searches."
      >
        <ul className="flex flex-wrap gap-2" aria-label="Subreddits">
          {state.subreddits.map((s, i) => (
            <li key={s}>
              <Chip className="pr-1">
                <span>r/{s}</span>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "removeSubreddit", index: i })}
                  aria-label={`Remove r/${s}`}
                  className="ml-1 inline-flex size-7 items-center justify-center rounded-[2px] text-muted hover:text-ink"
                >
                  <span aria-hidden="true">{"×"}</span>
                </button>
              </Chip>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          {state.subreddits.length} of {MAX_SUBREDDITS} subreddits
        </p>
        <div className="space-y-1.5">
          <label htmlFor="new-subreddit" className="block text-sm font-medium">
            Add a subreddit
          </label>
          <div className="flex gap-2">
            <input
              id="new-subreddit"
              value={newSub}
              maxLength={24}
              spellCheck={false}
              onChange={(e) => setNewSub(e.target.value)}
              onKeyDown={onEnter(addSubreddit)}
              aria-invalid={subError ? true : undefined}
              aria-describedby={subError ? "new-subreddit-error" : undefined}
              className={fieldClass}
            />
            <Button variant="secondary" onClick={addSubreddit}>
              Add
            </Button>
          </div>
          <p id="new-subreddit-error" className="min-h-5 text-sm text-negative">
            {subError ?? errors.subreddits}
          </p>
        </div>
      </Section>

      <Section
        title="Match threshold"
        hint="Each post gets a match score from 0 to 100. Posts below this score are hidden by default."
      >
        <Field id="threshold" label="Minimum match" error={errors.relevance_threshold}>
          <div className="flex items-center gap-4">
            <input
              id="threshold"
              type="range"
              min={40}
              max={95}
              step={1}
              value={state.relevance_threshold}
              onChange={(e) => dispatch({ type: "threshold", value: Number(e.target.value) })}
              aria-describedby={describedBy("threshold", false, errors.relevance_threshold)}
              className="w-full max-w-sm accent-[var(--accent)]"
            />
            <output htmlFor="threshold" className="w-10 text-right font-medium tabular-nums">
              {state.relevance_threshold}
            </output>
          </div>
        </Field>
      </Section>

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-6">
        <Button disabled={pending} onClick={() => run("confirm")}>
          Confirm and continue
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => run("save")}>
          Save changes
        </Button>
        <Button href="/app/onboarding?step=url" variant="quiet">
          Start again from a web address
        </Button>
      </div>
      <p className="text-sm text-muted">
        Nothing is collected until you confirm and start your trial.
      </p>
    </form>
  );
}
