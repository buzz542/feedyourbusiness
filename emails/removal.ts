import type { RenderedEmail } from "./trial-reminder";

/**
 * Removal received and done (docs/PLAN.md 4.8, 11), to the contact address the requester gave.
 * Never a post excerpt (2.3.14), no images, no tracking. US English, no em dashes.
 */

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const html = (paragraphs: readonly string[]) =>
  paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");

export function renderRemovalReceived(): RenderedEmail {
  const lines = [
    "We have your request to remove a post from AskedFor.",
    "We handle every request within 30 days, and we aim to do it within 72 hours. We will email you when it is done.",
    "If you did not ask for this, reply to this email and tell us.",
  ];
  return { subject: "We have your removal request", text: lines.join("\n\n"), html: html(lines) };
}

export function renderRemovalDone(input: { outcome: "removed" | "not_found" }): RenderedEmail {
  const lines =
    input.outcome === "removed"
      ? [
          "We have deleted the posts we held from you on that platform, and we will not store your posts from it again.",
          "If you have questions, reply to this email.",
        ]
      : [
          "We could not find a post we hold that matches your request, so there was nothing to delete.",
          "If you reply with your username on that platform, we will make sure we never store your posts from it.",
        ];
  return { subject: "Your removal request", text: lines.join("\n\n"), html: html(lines) };
}
