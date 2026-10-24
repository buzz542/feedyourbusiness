import { signOutAction } from "@/app/auth/actions";

/** A native disclosure, so it works by keyboard with no script. */
export function AccountMenu({ email }: { email: string | null }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-[2px] px-2 py-1 text-sm text-muted hover:text-ink">
        Account
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-64 rounded-[2px] border border-rule bg-paper p-3 text-sm">
        {email ? <p className="truncate text-muted">{email}</p> : null}
        <form action={signOutAction} className="mt-2">
          <button type="submit" className="underline underline-offset-4 hover:text-ink">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
