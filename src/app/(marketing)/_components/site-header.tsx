import Link from "next/link";
import { Wordmark } from "@/components/ui/brand";
import { isLaunchOpen } from "@/lib/launch";
import { CtaLink } from "./tracked";

/**
 * The site navigation (the founder's redesign brief, 27 Nov 2026): a centered, rounded, pale-grey
 * bar with the wordmark, How it works, Example, Pricing, Sign in and, once sign-up is open, Start
 * your trial. The logo is the mark alone, with the name spelled out in the middle (not on a
 * narrow phone).
 */
export function SiteHeader() {
  const open = isLaunchOpen();
  return (
    <header className="sticky top-3 z-30 py-3">
      <nav
        aria-label="Site"
        className="mx-auto flex max-w-4xl items-center gap-1 rounded-full border border-rule bg-panel/95 py-2 pr-2 pl-4 backdrop-blur-sm"
      >
        <Link href="/" className="mr-auto" aria-label="FeedYourBusiness, home">
          <Wordmark />
        </Link>
        {/* The name in words, centered in the gap between the logo and the links, so FYB reads as
            the logo and not as the name of the business (the founder, 27 Nov 2026). The logo link
            already names us for assistive technology. Below 430px there is no room for it. */}
        <span
          aria-hidden="true"
          className="hidden min-w-0 flex-1 truncate px-6 text-center text-sm font-semibold tracking-tight text-ink min-[430px]:block"
        >
          FeedYourBusiness
        </span>
        <div className="hidden items-center gap-1 text-sm text-muted md:flex">
          <Link href="/#how" className="rounded-full px-3 py-1.5 hover:text-ink">
            How it works
          </Link>
          <Link href="/#example" className="rounded-full px-3 py-1.5 hover:text-ink">
            Example
          </Link>
          <Link href="/pricing" className="rounded-full px-3 py-1.5 hover:text-ink">
            Pricing
          </Link>
        </div>
        <Link
          href="/login"
          className="ml-auto rounded-full px-3 py-1.5 text-sm whitespace-nowrap text-muted hover:text-ink md:ml-2"
        >
          Sign in
        </Link>
        {/* To pricing, never straight to checkout: every page shows this button, and the full
            price and trial terms must sit beside the action that starts a paid trial. */}
        {open ? (
          <CtaLink
            placement="nav"
            href="/pricing"
            className="inline-flex min-h-9 items-center rounded-full bg-accent-fill px-4 text-sm font-medium whitespace-nowrap text-accent-ink hover:opacity-90"
          >
            Start your trial
          </CtaLink>
        ) : null}
      </nav>
    </header>
  );
}
