import { signOutAction } from "@/app/auth/actions";

/**
 * The account: your email and Sign out. "menu" is a native disclosure for the narrow top bar, so it
 * works by keyboard with no script; "inline" sits at the foot of the side panel.
 */
export function AccountMenu({
  email,
  variant = "menu",
}: {
  email: string | null;
  variant?: "menu" | "inline";
}) {
  const body = (
    <>
      {email ? (
        <p className="truncate text-muted" title={email}>
          {email}
        </p>
      ) : null}
      <form action={signOutAction} className="mt-1.5">
        <button type="submit" className="text-ink underline underline-offset-4 hover:text-accent">
          Sign out
        </button>
      </form>
    </>
  );
  if (variant === "inline") return <div className="min-w-0 text-sm">{body}</div>;
  return (
    <details className="relative">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-[2px] px-2 text-sm text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        Account
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-64 rounded-[2px] border border-control bg-surface p-3 text-sm">
        {body}
      </div>
    </details>
  );
}
