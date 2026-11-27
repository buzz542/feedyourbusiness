"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FEED_KEYS, feedKeyAction, moveIndex } from "./feed-keys";

const ACTION_SELECTOR = {
  open: '[data-action="open"]',
  save: '[data-action="save"]',
  replied: '[data-action="replied"]',
  hide: '[data-action="hide"]',
} as const;

/**
 * The Reply tab's keys (docs/PLAN.md 4.4). Cards are the elements marked data-feed-card; each
 * key presses the matching control in the current card, so keys and clicks share one code path.
 * Escape closes the list of keys.
 */
export function FeedKeyboard() {
  const [help, setHelp] = useState(false);
  const current = useRef(-1);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setHelp(false);
        return;
      }
      // A conversation's detail dialog is open: the page behind is inert, so its keys wait.
      if (document.querySelector("dialog[open]")) return;
      const action = feedKeyAction({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        target: event.target as HTMLElement | null,
      });
      if (!action) return;
      if (action === "help") {
        event.preventDefault();
        setHelp((open) => !open);
        return;
      }
      const cards = [...document.querySelectorAll<HTMLElement>("[data-feed-card]")];
      if (action === "next" || action === "previous") {
        event.preventDefault();
        // Start from the card that has focus, if the user tabbed or clicked into one.
        const focused = cards.findIndex((c) => c.contains(document.activeElement));
        current.current = moveIndex(focused >= 0 ? focused : current.current, action, cards.length);
        const card = cards[current.current];
        card?.focus();
        card?.scrollIntoView({ block: "nearest" });
        return;
      }
      const card = cards[current.current] ?? cards.find((c) => c.contains(document.activeElement));
      const control = card?.querySelector<HTMLElement>(ACTION_SELECTOR[action]);
      if (!control || (control as HTMLButtonElement).disabled) return;
      event.preventDefault();
      control.click();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!help) return null;
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="fixed right-4 bottom-24 z-30 w-72 rounded-xl border border-control bg-surface p-4 text-sm lg:bottom-6"
    >
      <h2 className="mb-3 font-serif text-lg tracking-tight">Keyboard shortcuts</h2>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2">
        {FEED_KEYS.map(([key, , label]) => (
          <div key={key} className="contents">
            <dt>
              <kbd className="inline-block min-w-6 rounded-md border border-control bg-paper px-1.5 text-center font-mono text-xs leading-5">
                {key}
              </kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
      <Button variant="secondary" className="mt-4" onClick={() => setHelp(false)}>
        Close
      </Button>
    </div>
  );
}
