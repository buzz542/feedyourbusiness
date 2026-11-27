"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { CloseIcon } from "./icons";

const PANEL: Record<"left" | "bottom", string> = {
  left: "mr-auto h-dvh max-h-none w-[min(20rem,85vw)] max-w-none border-r",
  bottom: "mt-auto max-h-[85dvh] w-full max-w-none rounded-t-3xl border-t",
};

/**
 * A sheet for narrow screens (the founder's brief: a navigation drawer and a compact filter
 * sheet). A button opens a native modal dialog, so the page behind is inert, focus stays inside and
 * Escape closes it. Focus goes to the title on open and back to the button on close. The backdrop,
 * the Close button and any link inside close it too. Its contents render only while it is open.
 */
export function Sheet({
  id,
  title,
  side,
  trigger,
  triggerClassName,
  triggerLabel,
  closeAbove,
  children,
}: {
  id: string;
  title: string;
  side: "left" | "bottom";
  trigger: ReactNode;
  triggerClassName?: string;
  /** The button's accessible name when the trigger shows no words. */
  triggerLabel?: string;
  /**
   * A media query past which the sheet's button is hidden (a phone turned to a wide screen): the
   * sheet closes then, so a hidden open dialog never leaves the page inert.
   */
  closeAbove?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const el = dialog.current;
    if (!open || !el || el.open) return;
    el.showModal();
    heading.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !closeAbove || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(closeAbove);
    const onChange = () => {
      if (query.matches) dialog.current?.close();
    };
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [open, closeAbove]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-controls={id}
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen(true)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <dialog
        ref={dialog}
        id={id}
        data-side={side}
        aria-labelledby={`${id}-title`}
        onClose={() => {
          setOpen(false);
          button.current?.focus();
        }}
        onPointerDown={(event) => {
          pressedBackdrop.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          // The backdrop is the dialog element itself (closes only when the press started there
          // too, so a drag that selects text never does); a link inside navigates and closes.
          const target = event.target as HTMLElement;
          if (
            (target === event.currentTarget && pressedBackdrop.current) ||
            target.closest("a[href]")
          )
            event.currentTarget.close();
        }}
        className={cx("m-0 border-rule bg-panel p-0 text-ink backdrop:bg-black/60", PANEL[side])}
      >
        {open ? (
          <div className="flex flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <header className="flex items-center gap-3">
              <h2
                ref={heading}
                id={`${id}-title`}
                tabIndex={-1}
                className="font-serif text-lg tracking-tight focus:outline-none"
              >
                {title}
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
