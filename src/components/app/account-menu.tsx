"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { signOutAction } from "@/app/auth/actions";

/**
 * Account menu: a native disclosure, so it works by keyboard. It also closes on Escape (returning
 * focus to the button), when focus leaves it, and when the page changes.
 */
export function AccountMenu({ email }: { email: string | null }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  return (
    <details
      ref={ref}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
      onBlur={(event) => {
        if (ref.current && !ref.current.contains(event.relatedTarget as Node | null))
          ref.current.open = false;
      }}
    >
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-[2px] px-2 text-sm text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        Account
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-64 rounded-[2px] border border-rule bg-paper p-3 text-sm">
        {email ? <p className="truncate text-muted">{email}</p> : null}
        <form action={signOutAction} className="mt-2">
          <button
            type="submit"
            className="min-h-10 w-full rounded-[2px] border border-rule-strong px-3 text-left hover:bg-sunk"
          >
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
