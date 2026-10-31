/**
 * Text checks for the onboarding draft (docs/PLAN.md 8.3). `isProductLabel` mirrors the database's
 * `private.are_product_labels()` (6.2), so the draft drops what the database would refuse instead of
 * failing the whole save. Change both together.
 */

const INVISIBLE = /[\p{Cc}\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]/u;
const PERSON_OR_LINK =
  /([@\uff20]|(^|[^a-z0-9])u[/\uff0f]|:\/\/|(^|[^a-z0-9])www\.|[a-z0-9-]\.[a-z]{2,63}[/\uff0f]|(^|[/\uff0f])(user|users|in|profile)[/\uff0f]|bsky\.social)/i;

/** A product, company or topic phrase of 1 to `max` characters: no handle, email, URL or profile. */
export function isProductLabel(text: string, max: number): boolean {
  return (
    text.length >= 1 &&
    text.length <= max &&
    text === text.trim() &&
    !INVISIBLE.test(text) &&
    !PERSON_OR_LINK.test(text)
  );
}

/** Our copy rules for text we show: hyphens for dashes, single spaces, no invisible characters. */
export function tidy(text: string): string {
  return text
    .replace(/\s*[\u2013\u2014\u2015]\s*/g, " - ")
    .replace(/[\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]/g, " ")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when text has a handle, an email address, a URL or a profile link anywhere in it. */
export const hasPersonOrLink = (text: string): boolean => PERSON_OR_LINK.test(text);

/** Longer text with every sentence that names a person, an email or a link removed. */
export function withoutPeopleOrLinks(text: string, max: number): string {
  const kept = tidy(text)
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence && !PERSON_OR_LINK.test(sentence));
  let out = "";
  for (const sentence of kept) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  return out;
}
