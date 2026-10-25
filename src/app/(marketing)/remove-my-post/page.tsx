import type { Metadata } from "next";
import { H2, LegalPlaceholder } from "../_components/legal-placeholder";
import { submitRemovalAction } from "./actions";

export const metadata: Metadata = { title: "Remove my post" };

const MESSAGES: Readonly<Record<string, { text: string; error: boolean }>> = {
  sent: {
    text: "Thank you. We received your request and will email you when it is done.",
    error: false,
  },
  invalid: { text: "Add the link or username and an email address we can reply to.", error: true },
  rate_limited: { text: "Too many requests from here today. Try again tomorrow.", error: true },
  error: { text: "Something went wrong on our side. Try again in a few minutes.", error: true },
};

const field = {
  className:
    "mt-1 block min-h-10 w-full rounded-[2px] border border-rule-strong bg-paper px-2 text-ink",
};

/** Remove my post (docs/PLAN.md 2.3.5, 4.8). Anyone may ask; no account needed. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { status } = await searchParams;
  const message = typeof status === "string" ? MESSAGES[status] : undefined;
  return (
    <LegalPlaceholder title="Remove my post">
      <p>
        If AskedFor shows a post you wrote, we will remove it and stop storing posts from your
        account. We act within 30 days, and we aim for 72 hours.
      </p>
      {message ? (
        <p
          role={message.error ? "alert" : "status"}
          className={`rounded-[2px] border p-3 text-sm ${message.error ? "border-negative text-negative" : "border-rule"}`}
        >
          {message.text}
        </p>
      ) : null}
      <form action={submitRemovalAction} className="space-y-4">
        <label className="block text-sm">
          Link to the post, or your username
          <input name="link_or_handle" required maxLength={500} {...field} />
        </label>
        <label className="block text-sm">
          Site (needed for a username)
          <select name="source" {...field} defaultValue="">
            <option value="">Choose a site</option>
            <option value="reddit">Reddit</option>
            <option value="hackernews">Hacker News</option>
            <option value="bluesky">Bluesky</option>
            <option value="x">X</option>
          </select>
        </label>
        <label className="block text-sm">
          Your email, so we can tell you when it is done
          <input name="contact_email" type="email" required maxLength={320} {...field} />
        </label>
        <label className="block text-sm">
          Anything else we should know (optional)
          <textarea name="details" maxLength={1000} rows={3} {...field} />
        </label>
        <button
          type="submit"
          className="inline-flex min-h-10 items-center rounded-[2px] bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          Send request
        </button>
      </form>
      <H2>What happens next</H2>
      <p>
        We delete the matching posts, add your account to our suppression list so its posts are
        never stored again, and email you. We use your email address only for this request.
      </p>
    </LegalPlaceholder>
  );
}
