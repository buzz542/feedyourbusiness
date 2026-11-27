import { cx } from "./cx";

/**
 * The FeedYourBusiness mark (the founder's brief, 27 Nov 2026): a speech bubble holding three feed
 * lines, the last one short, drawn in the current text color so it works on the white site and in
 * the dark app. Original; no third-party mark is used.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cx("h-6 w-6 shrink-0", className)}
    >
      <path
        fill="currentColor"
        d="M5 3h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-8.2l-4.1 3.4A1 1 0 0 1 5 20.6V18a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"
      />
      <path
        stroke="var(--paper)"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M7 7.75h10M7 10.75h10M7 13.75h5.5"
      />
    </svg>
  );
}

/** The mark and the wordmark together, as one name for assistive technology. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <BrandMark />
      <span>FeedYourBusiness</span>
    </span>
  );
}
