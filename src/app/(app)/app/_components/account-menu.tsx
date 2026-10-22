import Link from "next/link";

/** Account menu without client JavaScript: a disclosure with the email, Settings and Sign out. */
export function AccountMenu({ email }: { email: string | null }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-[2px] border border-rule px-2 py-1 text-sm">
        Account
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-60 rounded-[2px] border border-rule bg-surface p-3 text-sm">
        {email ? <p className="truncate text-muted">{email}</p> : null}
        <Link href="/app/settings" className="mt-2 block underline-offset-4 hover:underline">
          Settings
        </Link>
        <form action="/auth/signout" method="post" className="mt-2">
          <button type="submit" className="text-accent underline-offset-4 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
