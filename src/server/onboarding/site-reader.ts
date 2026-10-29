import { OwnSiteError, type OwnSitePage } from "@/server/net/own-site";
import {
  extractPageText,
  extractSameSiteLinks,
  MAX_PAGE_TEXT,
  parseRobots,
  robotsAllows,
} from "./page-text";

/**
 * The site reader (docs/PLAN.md 8.3 step 2). Reads the pasted page and up to 5 more pages on the
 * same site that say what the product does, so the draft works from more than a landing page.
 *
 *   * Only links on the pasted page's own host (robots rules are per host), and only pages whose
 *     path names what the product does. Pages mostly about people (customers, team, careers,
 *     blog) are never read, not even through a redirect; a pasted one is swapped for the home page.
 *   * The extra pages honor robots.txt for AskedFor and `*` (RFC 9309): a 4xx answer allows them;
 *     a 5xx, a timeout or any refusal reads no extra pages. A page that redirects to a disallowed
 *     path is thrown away.
 *   * At most 5 attempts, failures included, one at a time through fetchOwnSite(), each started only
 *     when a full fetch still fits in the 30 second budget. Nothing read here is stored.
 */

export interface SiteReaderDeps {
  /** fetchOwnSite(), injected so tests never touch the network. */
  fetchPage: (url: string) => Promise<OwnSitePage>;
  /** Milliseconds; injected so tests can spend the budget. */
  now: () => number;
  budgetMs?: number;
}

export interface SiteText {
  text: string;
  /** The URLs read, the pasted page first. */
  pages: string[];
}

export const MAX_EXTRA_PAGES = 5;
const DEFAULT_BUDGET_MS = 30_000;
/** fetchOwnSite()'s own time limit: a fetch starts only if this much budget is left. */
const FETCH_MS = 10_000;

/** Path words for pages that say what a product does, best first. A trailing "s" also matches. */
const WANTED = [
  "pricing",
  "feature",
  "product",
  "how-it-works",
  "use-case",
  "solution",
  "alternative",
  "vs",
  "compare",
  "faq",
  "doc",
  "integration",
  "about",
];
/** Path words for pages that are mostly about people, or that say nothing about the product. */
const NEVER = [
  "customer",
  "leadership",
  "staff",
  "employee",
  "advisor",
  "investor",
  "member",
  "contributor",
  "mentor",
  "speaker",
  "showcase",
  "portfolio",
  "our-work",
  "hiring",
  "case-study",
  "case-studies",
  "story",
  "stories",
  "wall-of-love",
  "founder",
  "community",
  "forum",
  "contact",
  "team",
  "career",
  "job",
  "blog",
  "press",
  "news",
  "author",
  "people",
  "testimonial",
  "review",
  "login",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "register",
  "account",
  "cart",
  "checkout",
  "legal",
  "privacy",
  "terms",
  "cookie",
];

const wordIn = (path: string, word: string): boolean =>
  new RegExp(`(?:^|[/_.-])${word.replace(/-/g, "\\-")}s?(?:$|[/_.-])`).test(path);

/** True for a path with any word about people or with nothing about the product. */
export const isPeoplePath = (path: string): boolean => {
  const lower = path.toLowerCase();
  return NEVER.some((w) => wordIn(lower, w));
};

function rank(path: string): number {
  if (isPeoplePath(path)) return -1;
  const lower = path.toLowerCase();
  return WANTED.findIndex((w) => wordIn(lower, w));
}

/** Candidate extra pages on the first page's own host, best first. */
export function pickPages(links: readonly string[], firstPage: string): string[] {
  const first = new URL(firstPage);
  return links
    .filter((href) => new URL(href).hostname === first.hostname)
    .map((href, order) => ({ href, order, score: rank(new URL(href).pathname) }))
    .filter((l) => l.score >= 0 && new URL(l.href).pathname !== first.pathname)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map((l) => l.href);
}

function pageText(page: OwnSitePage): string {
  if (page.contentType !== "text/plain") return extractPageText(page.body);
  return page.body
    .replace(/[\u2012-\u2015\u2212]/g, "-")
    .replace(/\s+\n/g, "\n")
    .trim()
    .slice(0, MAX_PAGE_TEXT);
}

function join(parts: { url: string; text: string }[]): string {
  let out = "";
  for (const { url, text } of parts) {
    const block = `${out ? "\n\n" : ""}Page: ${new URL(url).pathname}\n${text}`;
    if (out.length + block.length > MAX_PAGE_TEXT) {
      const room = MAX_PAGE_TEXT - out.length;
      if (room > 200) out += block.slice(0, room).trimEnd();
      break;
    }
    out += block;
  }
  return out;
}

/**
 * robots.txt as text, "" when the site has none (any 4xx), or null when it could not be read for
 * any other reason, which means no extra pages (RFC 9309, 2.3.1.3 and 2.3.1.4).
 */
async function readRobots(pageUrl: string, deps: SiteReaderDeps): Promise<string | null> {
  try {
    return (await deps.fetchPage(new URL("/robots.txt", pageUrl).href)).body;
  } catch (error) {
    const status = error instanceof OwnSiteError ? error.status : undefined;
    return status !== undefined && status >= 400 && status < 500 ? "" : null;
  }
}

async function fetchQuietly(url: string, deps: SiteReaderDeps): Promise<OwnSitePage | null> {
  try {
    return await deps.fetchPage(url);
  } catch {
    return null;
  }
}

export async function readSite(url: string, deps: SiteReaderDeps): Promise<SiteText | null> {
  const budget = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const start = deps.now();
  const fits = () => deps.now() - start + FETCH_MS <= budget;
  const home = new URL("/", url).href;

  // A pasted people page (or one that redirects to such a page) is swapped for the home page.
  // The extra fetch counts as one of the 5 attempts, so a reading never passes 7 requests.
  let swapped = false;
  let first = await fetchQuietly(isPeoplePath(new URL(url).pathname) ? home : url, deps);
  if (first && isPeoplePath(new URL(first.url).pathname)) {
    swapped = true;
    first = fits() ? await fetchQuietly(home, deps) : null;
    if (first && isPeoplePath(new URL(first.url).pathname)) first = null;
  }
  if (!first) return null;
  const read: { url: string; text: string }[] = [{ url: first.url, text: pageText(first) }];

  if (first.contentType === "text/html") {
    const firstHost = new URL(first.url).hostname;
    const links = pickPages(extractSameSiteLinks(first.body, first.url), first.url);
    const robots = links.length && fits() ? await readRobots(first.url, deps) : null;
    const rules = parseRobots(robots ?? "");
    const allowed = (href: string) => robotsAllows(rules, new URL(href).pathname);
    const attempts: string[] = [];
    for (const link of robots === null ? [] : links) {
      if (attempts.length >= MAX_EXTRA_PAGES - (swapped ? 1 : 0)) break;
      if (allowed(link)) attempts.push(link);
    }
    for (const candidate of attempts) {
      if (!fits()) break;
      const next = await fetchQuietly(candidate, deps);
      if (!next) continue; // A failed page still counts as an attempt.
      const landed = new URL(next.url);
      if (landed.hostname !== firstHost || isPeoplePath(landed.pathname) || !allowed(next.url)) {
        continue;
      }
      read.push({ url: next.url, text: pageText(next) });
    }
  }

  const withText = read.filter((p) => p.text);
  if (withText.length === 0) return null;
  return { text: join(withText), pages: read.map((p) => p.url) };
}
