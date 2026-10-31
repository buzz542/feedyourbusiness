import { decodeEntities } from "@/lib/html-entities";
import { isSameSite } from "@/server/net/own-site";

/**
 * Page text for the onboarding draft (docs/PLAN.md 8.3 step 2): the visible words of a page,
 * same-site links to read next, and robots.txt rules. Small on purpose; no HTML library (5.3).
 *
 * Text keeps the title, the meta description, headings and body text, and drops scripts, styles,
 * navigation, footers, hidden elements, SVG, templates and comments. Dashes become hyphens, so the
 * draft cannot carry an em dash into a profile we show.
 */

export const MAX_PAGE_TEXT = 30_000;

/** Elements whose whole subtree is dropped. */
const SKIP = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "math",
  "template",
  "iframe",
  "object",
  "canvas",
  "select",
  "nav",
  "footer",
  "head",
]);
/** Elements whose content is raw text until their closing tag. */
const RAW_TEXT = new Set(["script", "style", "title", "textarea", "noscript"]);
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const BLOCK = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

const ATTRS = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(text: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of text.matchAll(ATTRS)) {
    attrs.set((m[1] ?? "").toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ""));
  }
  return attrs;
}

const isHiddenOrNav = (attrs: Map<string, string>): boolean =>
  attrs.has("hidden") ||
  attrs.get("aria-hidden") === "true" ||
  ["navigation", "contentinfo", "banner-nav"].includes(attrs.get("role") ?? "");

/** Hrefs and URLs longer than this are ignored; nothing real needs more. */
export const MAX_URL_LENGTH = 2048;
/** Links considered per page; a page with more is not a product site we can read well. */
const MAX_LINKS = 500;

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: string;
}

const TAG_NAME = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/;

/**
 * One linear pass over HTML: text runs and tags, in order. Comments, doctypes and processing
 * instructions are skipped; raw-text elements (script, style, title...) hand their content to
 * `onRawText` and resume after their closing tag. Only indexOf and anchored, bounded regexes, so
 * hostile markup costs linear time (no backtracking blow-ups).
 */
function scan(
  html: string,
  onText: (text: string) => void,
  onTag: (tag: Tag) => void,
  onRawText: (name: string, content: string) => void = () => {},
): void {
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      onText(html.slice(i));
      return;
    }
    if (lt > i) onText(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    const next = html[lt + 1];
    if (next === "!" || next === "?") {
      const end = html.indexOf(">", lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const m = TAG_NAME.exec(html.slice(lt, lt + 64));
    if (!m) {
      onText("<");
      i = lt + 1;
      continue;
    }
    const end = html.indexOf(">", lt);
    const attrs = html.slice(lt + m[0].length, end === -1 ? n : end);
    i = end === -1 ? n : end + 1;
    const name = (m[2] ?? "").toLowerCase();
    const closing = m[1] === "/";
    const selfClosing = /\/\s*$/.test(attrs.slice(-8)) || VOID.has(name);
    onTag({ name, closing, selfClosing, attrs });
    if (!closing && RAW_TEXT.has(name)) {
      const close = new RegExp(`</${name}(?=[\\s/>]|$)`, "gi");
      close.lastIndex = i;
      const found = close.exec(html);
      onRawText(name, html.slice(i, found ? found.index : n));
      if (!found) return;
      const after = html.indexOf(">", found.index);
      i = after === -1 ? n : after + 1;
    }
  }
}

/** Visible text of an HTML page, at most `max` characters, one line per block. */
export function extractPageText(html: string, max = MAX_PAGE_TEXT): string {
  let title = "";
  let description = "";
  const out: string[] = [];
  let skipName: string | null = null;
  let skipDepth = 0;

  scan(
    html,
    (text) => {
      if (!skipName) out.push(decodeEntities(text));
    },
    ({ name, closing, selfClosing, attrs: rawAttrs }) => {
      if (closing) {
        if (skipName === name && --skipDepth === 0) skipName = null;
        if (!skipName && BLOCK.has(name)) out.push("\n");
        return;
      }
      if (skipName) {
        if (name === skipName && !selfClosing && !RAW_TEXT.has(name)) skipDepth++;
        return;
      }
      if (RAW_TEXT.has(name)) return;
      const attrs = parseAttrs(rawAttrs);
      if (name === "meta") {
        const key = attrs.get("name") ?? attrs.get("property") ?? "";
        if (/^(description|og:description)$/i.test(key)) description ||= attrs.get("content") ?? "";
        return;
      }
      if (!selfClosing && name !== "head" && (SKIP.has(name) || isHiddenOrNav(attrs))) {
        skipName = name;
        skipDepth = 1;
        return;
      }
      if (BLOCK.has(name)) out.push("\n");
    },
    (name, content) => {
      if (name === "title" && !title && !skipName) title = decodeEntities(content);
    },
  );

  const lines = [title, description, ...out.join("").split("\n")]
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const joined = lines.join("\n");
  if (joined.length <= max) return joined;
  const cut = joined.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  return (lastBreak > max * 0.8 ? cut.slice(0, lastBreak) : cut).trimEnd();
}

/** https links on the same site as `base` (same host or its www twin), no query or fragment. */
export function extractSameSiteLinks(html: string, base: string): string[] {
  const baseUrl = new URL(base);
  const seen = new Set<string>();
  scan(
    html,
    () => {},
    ({ name, closing, attrs }) => {
      if (closing || name !== "a" || seen.size >= MAX_LINKS) return;
      const href = decodeEntities(parseAttrs(attrs).get("href") ?? "").trim();
      if (!href || href.length > MAX_URL_LENGTH) return;
      let url: URL;
      try {
        url = new URL(href, baseUrl);
      } catch {
        return;
      }
      if (url.protocol !== "https:" || !isSameSite(baseUrl.hostname, url.hostname)) return;
      url.search = "";
      url.hash = "";
      if (url.href.length <= MAX_URL_LENGTH) seen.add(url.href);
    },
  );
  return [...seen];
}

export const ROBOTS_AGENT = "askedfor";
/** robots.txt is read up to this many characters and rules, as RFC 9309 allows (at least 500 KiB). */
const MAX_ROBOTS_CHARS = 512 * 1024;
const MAX_ROBOTS_RULES = 2000;

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

/**
 * The rules that apply to AskedFor (RFC 9309 2.2.1): the groups whose product token is exactly
 * ours, ignoring case and anything after the token (`AskedFor/1.0`), or else the `*` groups.
 */
export function parseRobots(robots: string, agent = ROBOTS_AGENT): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  let rules = 0;
  for (const rawLine of robots.slice(0, MAX_ROBOTS_CHARS).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(
        value === "*" ? "*" : (value.match(/^[a-z_-]+/i)?.[0] ?? "").toLowerCase(),
      );
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current && rules < MAX_ROBOTS_RULES) {
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
      rules++;
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const ours = groups.filter((g) => g.agents.includes(agent.toLowerCase()));
  const chosen = ours.length ? ours : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

/** `*` matches any run of characters and a trailing `$` anchors the end. Linear: no backtracking. */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  const first = parts[0] ?? "";
  if (!path.startsWith(first)) return false;
  let pos = first.length;
  for (let k = 1; k < parts.length; k++) {
    const part = parts[k] ?? "";
    if (anchored && k === parts.length - 1) {
      return path.length - part.length >= pos && path.endsWith(part);
    }
    const at = path.indexOf(part, pos);
    if (at === -1) return false;
    pos = at + part.length;
  }
  return anchored ? pos === path.length : true;
}

/** Longest matching rule wins; on a tie, allow wins; no rule means allowed. */
export function robotsAllows(rules: readonly RobotsRule[], path: string): boolean {
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!robotsPatternMatches(rule.pattern, path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

/** True when robots.txt lets AskedFor (or, failing a group for it, `*`) fetch `path`. */
export function isAllowedByRobots(robots: string, path: string, agent = ROBOTS_AGENT): boolean {
  return robotsAllows(parseRobots(robots, agent), path);
}
