import Link from "next/link";
import { TradingDetails } from "./trading-details";

const links = [
  { href: "/privacy", label: "Privacy notice" },
  { href: "/remove-my-post", label: "Remove my post" },
  { href: "/terms", label: "Terms" },
  { href: "/acceptable-use", label: "Acceptable use" },
  { href: "/cookies", label: "Cookies" },
  { href: "/sources", label: "Sources" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-rule py-8 text-sm text-muted">
      <nav aria-label="Legal">
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="underline underline-offset-4 hover:text-ink">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <TradingDetails />
    </footer>
  );
}
