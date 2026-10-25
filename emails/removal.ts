import type { RenderedEmail } from "./trial-reminder";

/** Emails to someone who asked us to remove a post (docs/PLAN.md 11). Service emails, one-off. */

export function renderRemovalReceived(): RenderedEmail {
  const lines = [
    "We received your request to remove a post from AskedFor.",
    "We will act on it within 30 days, and we aim for 72 hours. We will email you when it is done.",
    "You do not need to do anything else.",
  ];
  return {
    subject: "We received your removal request",
    text: lines.join("\n\n"),
    html: lines.map((l) => `<p>${l}</p>`).join("\n"),
  };
}

export function renderRemovalDone(outcome: "removed" | "not_found"): RenderedEmail {
  const lines =
    outcome === "removed"
      ? [
          "We removed the posts you asked about from AskedFor.",
          "We also added the account to our suppression list, so AskedFor will not store its posts again.",
        ]
      : [
          "We could not match your request to anything AskedFor holds.",
          "If you reply with a link to the post, or the username and the site, we will look again.",
        ];
  return {
    subject:
      outcome === "removed" ? "Your post was removed from AskedFor" : "About your removal request",
    text: lines.join("\n\n"),
    html: lines.map((l) => `<p>${l}</p>`).join("\n"),
  };
}
