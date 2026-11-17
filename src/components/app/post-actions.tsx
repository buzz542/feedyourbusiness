"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { CheckIcon } from "@/components/ui/icons";
import { useFeedCounts } from "./feed-counts";

type State = "new" | "saved" | "replied" | "hidden";
type Pressable = Exclude<State, "new">;

export type SetPostState = (input: { id: string; state: State }) => Promise<{ ok: boolean }>;

const DONE: Record<State, string> = {
  new: "Moved back.",
  saved: "Saved.",
  replied: "Marked replied.",
  hidden: "Hidden.",
};

/** The card's toggles in order. data-action is what the keys press (feed-keys.ts). */
const TOGGLES: ReadonlyArray<{ state: Pressable; action: string; label: string }> = [
  { state: "saved", action: "save", label: "Save" },
  { state: "hidden", action: "hide", label: "Hide" },
  { state: "replied", action: "replied", label: "I replied" },
];

/** Pressing a toggle moves the post there; pressing the one that is on moves it back to new. */
export const nextState = (current: State, pressed: Pressable): State =>
  current === pressed ? "new" : pressed;

const TOGGLE =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[2px] border px-2.5 py-1.5 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50 sm:px-3";

/**
 * Open post, then Save, Hide and I replied (docs/PLAN.md 4.4), with Undo for the last change.
 * The toggles never leave the card, so the focus stays where it was; the pressed one says so with
 * aria-pressed, a check and its border, never color alone. `open` is the Open post link. Each
 * change the server accepts is passed to the side panel's counts, with what they are counted by.
 */
export function PostActions({
  id,
  state: initial,
  setState,
  open,
  counted,
}: {
  id: string;
  state: State;
  setState: SetPostState;
  open?: ReactNode;
  counted?: { createdAt: string; relevance: number };
}) {
  const { moved } = useFeedCounts();
  const [state, setLocal] = useState<State>(initial);
  const [previous, setPrevious] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const change = (next: State, undo = false) =>
    start(async () => {
      const before = state;
      const { ok } = await setState({ id, state: next });
      setFailed(!ok);
      if (!ok) return;
      setLocal(next);
      setPrevious(undo ? null : before);
      if (counted) moved(counted, before, next);
    });

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-state={state}
      aria-busy={pending || undefined}
    >
      {open}
      {TOGGLES.map((toggle) => {
        const on = state === toggle.state;
        return (
          <button
            key={toggle.action}
            type="button"
            data-action={toggle.action}
            aria-pressed={on}
            disabled={pending}
            onClick={() => change(nextState(state, toggle.state))}
            className={cx(
              TOGGLE,
              on ? "border-accent bg-selected" : "border-control bg-surface hover:border-ink",
            )}
          >
            {on ? <CheckIcon size={14} /> : null}
            {toggle.label}
          </button>
        );
      })}
      <span className="ml-auto flex items-center gap-2 text-sm">
        <span role="status" aria-live="polite" className="text-muted">
          {failed ? "That did not save. Try again." : previous ? DONE[state] : null}
        </span>
        {previous ? (
          <Button variant="quiet" disabled={pending} onClick={() => change(previous, true)}>
            Undo
          </Button>
        ) : null}
      </span>
    </div>
  );
}
