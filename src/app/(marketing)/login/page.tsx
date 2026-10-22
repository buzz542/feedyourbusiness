import type { Metadata } from "next";
import { Button } from "@/components/ui";
import { PRIVATE_BETA_MESSAGE } from "@/server/auth/allowlist";
import { safeNextPath } from "@/server/auth/safe-next";
import { googleSignInAction, sendMagicLinkAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  private_beta: `${PRIVATE_BETA_MESSAGE} Sign-in is open to invited emails only.`,
  invalid_email: "Enter a valid email address.",
  link: "That sign-in link did not work. It may have expired. Ask for a new one below.",
  error: "Something went wrong on our side. Try again in a minute.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === "string" ? params[k] : undefined);
  const next = safeNextPath(one("next"));
  const error = ERRORS[one("error") ?? ""];
  const sent = one("sent") === "yes";

  return (
    <div className="max-w-sm">
      <h1 className="font-serif text-3xl tracking-tight">Sign in</h1>

      <div aria-live="polite" className="mt-4">
        {sent ? (
          <p className="rounded-[2px] border border-rule bg-surface p-3 text-sm">
            Check your email for a sign-in link. You can close this tab.
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-[2px] border border-negative p-3 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}
      </div>

      <form action={sendMagicLinkAction} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email" className="text-sm font-medium">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          className="rounded-[2px] border border-rule bg-surface px-3 py-2"
        />
        <Button type="submit">Email me a sign-in link</Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-rule" />
        or
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form action={googleSignInAction}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="secondary" className="w-full">
          Continue with Google
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted">
        New accounts confirm their age and the terms on the next screen.
      </p>
    </div>
  );
}
