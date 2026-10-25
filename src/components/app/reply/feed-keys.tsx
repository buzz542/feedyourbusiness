"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keyboard shortcuts for the Reply feed (docs/PLAN.md 4.4): j and k move between cards, o opens the
 * post, s saves, r marks replied, h hides, ? shows the keys. Ignored while typing in a field.
 */
export const FEED_KEYS: readonly [string, string][] = [
  ["j", "Next card"],
  ["k", "Previous card"],
  ["o", "Open the post"],
  ["s", "Save"],
  ["r", "Mark replied"],
  ["h", "Hide"],
  ["?", "Show or hide these keys"],
];

const ACTIONS: Readonly<Record<string, string>> = { s: "save", r: "replied", h: "hidden" };

export function FeedKeys() {
  const [help, setHelp] = useState(false);
  const index = useRef(-1);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const cards = () => Array.from(document.querySelectorAll<HTMLElement>("[data-card]"));
    const current = () => {
      const all = cards();
      const focused = all.findIndex((c) => c.contains(document.activeElement));
      if (focused >= 0) index.current = focused;
      return all[index.current] ?? null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key;
      if (key === "?") {
        event.preventDefault();
        setHelp((open) => !open);
        return;
      }
      if (key === "j" || key === "k") {
        const all = cards();
        if (all.length === 0) return;
        event.preventDefault();
        current();
        index.current =
          key === "j"
            ? Math.min(all.length - 1, index.current + 1)
            : Math.max(0, index.current - 1);
        const card = all[index.current]!;
        card.focus();
        card.scrollIntoView({ block: "nearest" });
        return;
      }
      const card = current();
      if (!card) return;
      if (key === "o") {
        event.preventDefault();
        card.querySelector<HTMLAnchorElement>("[data-open]")?.click();
      } else if (ACTIONS[key]) {
        event.preventDefault();
        card.querySelector<HTMLButtonElement>(`[data-action='${ACTIONS[key]}']`)?.click();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (help && !d.open) d.showModal();
    if (!help && d.open) d.close();
  }, [help]);

  return (
    <>
      <p className="hidden text-sm text-muted sm:block">
        Press <kbd className="rounded-[2px] border border-rule px-1">?</kbd> for keyboard shortcuts.
      </p>
      <dialog
        ref={dialog}
        onClose={() => setHelp(false)}
        aria-labelledby="feed-keys-title"
        className="m-auto rounded-[2px] border border-rule bg-paper p-6 text-ink backdrop:bg-black/40"
      >
        <h2 id="feed-keys-title" className="font-serif text-lg tracking-tight">
          Keyboard shortcuts
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {FEED_KEYS.map(([key, what]) => (
            <div key={key} className="contents">
              <dt>
                <kbd className="rounded-[2px] border border-rule px-1.5">{key}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <form method="dialog" className="mt-4">
          <button
            type="submit"
            className="inline-flex min-h-10 items-center rounded-[2px] border border-rule-strong px-3 text-sm hover:bg-sunk"
          >
            Close
          </button>
        </form>
      </dialog>
    </>
  );
}
