/**
 * A billing moment with its time and zone (docs/PLAN.md 2.4, 10.1, 10.3): "November 9, 2026 at
 * 9:00 PM EST". Without `timeZone` it uses the runtime's own zone (the visitor's, in a browser).
 */
export function formatChargeTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}
