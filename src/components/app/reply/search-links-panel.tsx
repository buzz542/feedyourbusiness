import { DISCLOSURE } from "@/lib/reply-tips";
import type { LinkGroup } from "@/server/reply/search-links";

/**
 * One-tap searches the user opens in their own browser (docs/PLAN.md 4.4, 7.8). AskedFor fetches
 * none of these pages; platform names appear as text only.
 */
export function SearchLinksPanel({ groups }: { groups: readonly LinkGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="search-links" className="rounded-[2px] border border-rule p-4">
      <h2 id="search-links" className="font-serif text-lg tracking-tight">
        Search it yourself
      </h2>
      <p className="mt-1 text-sm text-muted">
        These open each site&apos;s own search in your browser. AskedFor does not read them for you.
      </p>
      <p className="mt-2 text-sm font-medium">{DISCLOSURE}</p>
      <div className="mt-3 space-y-2">
        {groups.map((group) => (
          <details key={group.label} className="text-sm">
            <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium">
              {group.label}
            </summary>
            <ul className="mt-1 flex flex-wrap gap-2">
              {group.links.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-8 items-center rounded-[2px] border border-rule-strong px-2.5 hover:bg-sunk"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
