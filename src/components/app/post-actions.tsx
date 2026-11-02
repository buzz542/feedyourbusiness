"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

type State = "new" | "saved" | "replied" | "hidden";

export type SetPostState = (input: { id: string; state: State }) => Promise<{ ok: boolean }>;

const DONE: Record<State, string> = {
  new: "Moved back.",
  saved: "Saved.",
  replied: "Marked replied.",
  hidden: "Hidden.",
};

/** Save, Mark replied, Hide, and Undo for the last of them (docs/PLAN.md 4.4). */
export function PostActions({
  id,
  state: initial,
  setState,
}: {
  id: string;
  state: State;
  setState: SetPostState;
}) {
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
    });

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      {state !== "saved" ? (
        <Button variant="secondary" disabled={pending} onClick={() => change("saved")}>
          Save
        </Button>
      ) : null}
      {state !== "replied" ? (
        <Button variant="secondary" disabled={pending} onClick={() => change("replied")}>
          Mark replied
        </Button>
      ) : null}
      {state !== "hidden" ? (
        <Button variant="quiet" disabled={pending} onClick={() => change("hidden")}>
          Hide
        </Button>
      ) : null}
      <span role="status" aria-live="polite" className="text-sm text-muted">
        {failed ? "That did not save. Try again." : previous ? DONE[state] : null}
      </span>
      {previous ? (
        <Button variant="quiet" disabled={pending} onClick={() => change(previous, true)}>
          Undo
        </Button>
      ) : null}
    </div>
  );
}
