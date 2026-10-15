import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { safeNextPath } from "@/server/auth/safe-next";
import { sendMagicLinkAction, signInWithGoogleAction } from "./actions";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const notices = new Map([
  ["link", "That sign-in link has expired or was already used. Request a new one below."],
  ["google", "Google sign-in did not finish. Try again, or use an email link."],
  [
    "first_time",
    "First time here? Sign in with an email link once. Google sign-in works after that.",
  ],
]);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };
  const next = safeNextPath(one("next"));
  const error = one("error");
  const notice = one("beta")
    ? "AskedFor is in private beta. Sign-in is open to invited makers for now."
    : error
      ? notices.get(error)
      : undefined;

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-serif text-3xl tracking-tight">Sign in</h1>
      <p className="mt-2 text-muted">Use an email link or your Google account.</p>

      {notice ? (
        <p role="alert" className="mt-6 rounded-[2px] border border-rule bg-sunk p-3 text-sm">
          {notice}
        </p>
      ) : null}

      <div className="mt-8">
        <LoginForm next={next} action={sendMagicLinkAction} />
      </div>

      <div className="my-6 flex items-center gap-3 text-sm text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-rule" />
        or
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form action={signInWithGoogleAction}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="secondary" className="w-full">
          Continue with Google
        </Button>
      </form>

      <p className="mt-8 text-sm text-muted">
        On your first visit you confirm your age and agree to the{" "}
        <Link href="/terms" className="underline underline-offset-4 hover:text-ink">
          Terms
        </Link>{" "}
        and the{" "}
        <Link href="/acceptable-use" className="underline underline-offset-4 hover:text-ink">
          Acceptable use policy
        </Link>
        .
      </p>
    </div>
  );
}
