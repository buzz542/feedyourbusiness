import Link from "next/link";
import { Wordmark } from "@/components/ui/brand";
import { CONTACT_EMAIL, CONTACT_EMAIL_LIVE } from "@/lib/contact";

const links = [
  { href: "/pricing", label: "Pricing" },
  { href: "/privacy", label: "Privacy notice" },
  { href: "/terms", label: "Terms" },
  { href: "/remove-my-post", label: "Remove my post" },
  { href: "/acceptable-use", label: "Acceptable use" },
  { href: "/cookies", label: "Cookies" },
  { href: "/sources", label: "Where posts come from" },
];

/**
 * The wordmark, every legal page and sign-in. Contact appears once the founder monitors the inbox
 * (CONTACT_EMAIL_LIVE, docs/claims.md "contact-email").
 */
export function SiteFooter({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <footer className="mt-16 border-t border-rule py-10 text-sm text-muted">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <Link href="/" className="text-ink" aria-label="FeedYourBusiness, home">
          <Wordmark />
        </Link>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 sm:justify-end">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-ink hover:underline">
                  {link.label}
                </Link>
              </li>
            ))}
            {signedIn ? null : (
              <li>
                <Link href="/login" className="hover:text-ink hover:underline">
                  Sign in
                </Link>
              </li>
            )}
            {CONTACT_EMAIL_LIVE ? (
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-ink hover:underline">
                  Contact
                </a>
              </li>
            ) : null}
          </ul>
        </nav>
      </div>
      {/* UK e-commerce rules need a trading name, a geographic address and a monitored email here. */}
      <p className="mt-6">Trading name, address and contact email are added before launch.</p>
    </footer>
  );
}
