"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { CheckIcon, CloseIcon } from "@/components/ui/icons";
import type { FeedItem } from "@/server/store/feed";
import { ConversationDetail } from "./conversation-detail";
import { useFeedCounts } from "./feed-counts";

type State = "new" | "saved" | "replied" | "hidden";
type Pressable = Exclude<State, "new">;

export type SetPostState = (input: { id: string; state: State }) => Promise<{ ok: boolean }>;

/** Records the user's first opened conversation (the database keeps one); best effort. */
export type MarkOpened = () => Promise<unknown>;

/** Asked once per page load: the event is a user's first open, so more would only repeat it. */
let openedAsked = false;
function askOpened(markOpened: MarkOpened | undefined) {
  if (!markOpened || openedAsked) return;
  openedAsked = true;
  markOpened().catch(() => undefined);
}

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
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50 sm:px-3";

/**
 * View conversation, then Save, Hide and I replied (docs/PLAN.md 4.4), with Undo for the last change.
 * The toggles never leave the card, so the focus stays where it was; the pressed one says so with
 * aria-pressed, a check and its border, never color alone. `open` is the View conversation link. Each
 * change the server accepts is passed to the side panel's counts, with what they are counted by.
 */
export function PostActions({
  id,
  state: initial,
  setState,
  open,
  counted,
  detail,
  markOpened,
}: {
  id: string;
  state: State;
  setState: SetPostState;
  open?: ReactNode;
  counted?: { createdAt: string; relevance: number };
  /**
   * The conversation detail's data, shown in a dialog from the Details button (the founder's
   * brief). Plain data, rendered here only while the dialog is open, so the page carries no second
   * rendered copy of each card.
   */
  detail?: { item: FeedItem; rivalName: string | null; now: string };
  /** Called when the conversation is opened: View conversation, or Details. */
  markOpened?: MarkOpened;
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

  const toggles = TOGGLES.map((toggle) => {
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
  });
  const status = (
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
  );

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-state={state}
      aria-busy={pending || undefined}
      // View conversation (clicked, or o) and Details both open the conversation.
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest('[data-action="open"], [data-action="details"]'))
          askOpened(markOpened);
      }}
    >
      {open}
      {toggles}
      {detail ? (
        <DetailDialog id={id}>
          <ConversationDetail
            item={detail.item}
            now={new Date(detail.now)}
            rivalName={detail.rivalName}
          />
          {/* The same controls as the card, sharing its state: a change here shows there too. */}
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-rule pt-4">
            {open}
            {toggles}
            {status}
          </div>
        </DetailDialog>
      ) : null}
      {status}
    </div>
  );
}

/**
 * The Details button and its dialog: a side panel on wide screens, full screen on phones. A native
 * modal dialog, so the page behind is inert, focus stays inside and Escape closes it; focus goes to
 * the panel's heading on open and back to the button on close. Its contents render only while it
 * is open, so the card never carries a second copy of its controls.
 */
function DetailDialog({ id, children }: { id: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [isOpen, setOpen] = useState(false);
  /** Where the press started: a drag that ends on the backdrop (selecting text) never closes it. */
  const pressedBackdrop = useRef(false);
  const dialogId = `detail-${id}`;

  useEffect(() => {
    const el = dialog.current;
    if (!isOpen || !el || el.open) return;
    el.showModal();
    heading.current?.focus();
  }, [isOpen]);

  return (
    <>
      <button
        ref={button}
        type="button"
        data-action="details"
        aria-haspopup="dialog"
        aria-controls={dialogId}
        aria-expanded={isOpen}
        // Which conversation: the card's source line and age, for anyone moving by button.
        aria-describedby={`meta-${id}`}
        onClick={() => setOpen(true)}
        className={cx(TOGGLE, "border-control bg-surface hover:border-ink")}
      >
        Details
      </button>
      <dialog
        ref={dialog}
        id={dialogId}
        aria-labelledby={`${dialogId}-title`}
        onClose={() => {
          setOpen(false);
          button.current?.focus();
        }}
        // A click on the backdrop (the dialog element itself, outside its panel) closes it, when
        // the press started there too.
        onPointerDown={(event) => {
          pressedBackdrop.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && pressedBackdrop.current)
            event.currentTarget.close();
        }}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-paper p-0 text-ink backdrop:bg-black/60 sm:ml-auto sm:max-w-md sm:border-l sm:border-rule"
      >
        {isOpen ? (
          <div className="flex min-h-full flex-col p-5 sm:p-6">
            <header className="mb-5 flex items-center gap-3">
              <h2
                ref={heading}
                id={`${dialogId}-title`}
                tabIndex={-1}
                className="font-serif text-xl tracking-tight focus:outline-none"
              >
                Conversation
              </h2>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                className="ml-auto inline-flex size-10 items-center justify-center rounded-full border border-control hover:border-ink"
              >
                <CloseIcon />
                <span className="sr-only">Close</span>
              </button>
            </header>
            {children}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
