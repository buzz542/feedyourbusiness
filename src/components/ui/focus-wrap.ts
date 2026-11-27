/**
 * Keeps Tab inside an open dialog (the founder's brief: keyboard-accessible dialogs). A native modal
 * dialog makes the page behind inert, but Tab past its last control can still leave for the
 * browser's own controls; this wraps it to the first, and Shift+Tab from the first to the last.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function wrapTab(
  event: { key: string; shiftKey: boolean; preventDefault(): void },
  container: HTMLElement,
): void {
  if (event.key !== "Tab") return;
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0,
  );
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}
