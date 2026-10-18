/**
 * The visible text of the user's product page, for the onboarding draft (docs/PLAN.md 8.3): title,
 * meta description, headings and body, with scripts, styles, navigation and hidden content removed,
 * at most 30,000 characters. A small single-pass tokenizer, so no HTML-parsing dependency is needed.
 * The page is untrusted (up to 2 MB from fetchOwnSite()), so every step is linear in its length.
 */

import { decodeEntities } from "@/lib/html-entities";

export const MAX_PAGE_TEXT = 30_000;
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 500;
const MAX_HEADING = 200;

/** Elements whose content is code or markup, never page text. Skipped up to their closing tag. */
const RAW_TEXT = ["script", "style", "noscript", "textarea", "xmp", "noembed", "noframes"] as const;
/** Elements skipped with everything inside them: navigation, chrome and embedded graphics. */
const SKIPPED = new Set([
  "nav",
  "footer",
  "svg",
  "math",
  "iframe",
  "object",
  "select",
  "dialog",
  "template",
  // Fallback content browsers only show when the media cannot play.
  "video",
  "audio",
  "canvas",
  "datalist",
]);
/** Elements whose next sibling of the same name closes them (HTML's optional end tags). */
const SIBLING_CLOSES = new Set(["li", "dt", "dd", "tr", "td", "th", "option"]);
/** The end of a comment: "-->" or "--!>" (the HTML tokenizer accepts both). */
const COMMENT_END = /--!?>/g;
const MAX_HEADINGS = 40;
/** The only elements where a self-closing slash means anything (foreign content). */
const FOREIGN = new Set(["svg", "math"]);
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
  "table",
  "tr",
  "ul",
]);
/** Table cells: separated by a space, so a row reads as one line. */
const CELLS = new Set(["td", "th"]);
/** Start tags that close an open <p> (HTML's implied end tag), so a skipped <p> ends there too. */
const CLOSES_P = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "dd",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "search",
  "section",
  "summary",
  "table",
  "ul",
]);
const HEADINGS = new Set(["h1", "h2", "h3"]);

interface Tag {
  name: string;
  closing: boolean;
  /** Ends in "/>". Only honored for foreign elements (svg, math), as in HTML. */
  selfClosing: boolean;
  attrs: Record<string, string>;
  end: number;
}

/** "<" not followed by a tag name: plain text. */
const NOT_A_TAG = "not-a-tag";
/** A tag that runs to the end of the input: nothing after it is text (as in HTML). */
const UNTERMINATED = "unterminated";

// Sticky patterns, matched in place: no slicing, no rescanning.
const TAG_NAME = /[a-zA-Z][a-zA-Z0-9:-]*/y;
const ATTR_NAME = /[^\s/>=]+/y;
const SPACE = /\s*/y;
const UNQUOTED = /[^\s>]*/y;

function matchAt(pattern: RegExp, text: string, at: number): string | null {
  pattern.lastIndex = at;
  return pattern.exec(text)?.[0] ?? null;
}

const skipSpace = (text: string, at: number) => at + (matchAt(SPACE, text, at)?.length ?? 0);

/** Parse the tag that starts at `start` ("<"), honoring quoted attribute values. */
function parseTag(html: string, start: number): Tag | typeof NOT_A_TAG | typeof UNTERMINATED {
  let i = start + 1;
  const closing = html[i] === "/";
  if (closing) i++;
  const rawName = matchAt(TAG_NAME, html, i);
  if (!rawName) return NOT_A_TAG;
  const name = rawName.toLowerCase();
  i += rawName.length;
  const attrs: Record<string, string> = {};
  let slash = false;
  while (i < html.length) {
    const c = html[i]!;
    if (c === ">") return { name, closing, selfClosing: slash, attrs, end: i + 1 };
    if (c === "/") {
      slash = true;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      // "<svg / >" is not self-closing: the slash must come right before ">".
      slash = false;
      i++;
      continue;
    }
    slash = false;
    const key = matchAt(ATTR_NAME, html, i);
    if (!key) {
      i++;
      continue;
    }
    i = skipSpace(html, i + key.length);
    let value = "";
    if (html[i] === "=") {
      i = skipSpace(html, i + 1);
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0) return UNTERMINATED;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        value = matchAt(UNQUOTED, html, i) ?? "";
        i += value.length;
      }
    }
    attrs[key.toLowerCase()] = decodeEntities(value);
  }
  return UNTERMINATED;
}

/** One case-insensitive end-tag pattern per raw-text element, run on the original string. */
const RAW_TEXT_END = new Map(
  RAW_TEXT.map((name) => [name as string, new RegExp(`</${name}(?=[\\s/>])`, "gi")]),
);

/** Where the raw-text element opened before `from` ends: just past its end tag, or the input. */
function rawTextEnd(html: string, name: string, from: number): number {
  const pattern = RAW_TEXT_END.get(name)!;
  pattern.lastIndex = from;
  const found = pattern.exec(html);
  if (!found) return html.length;
  const gt = html.indexOf(">", found.index);
  return gt < 0 ? html.length : gt + 1;
}

/**
 * Navigation landmarks, like <nav>. Elements marked hidden or aria-hidden are kept: React streams a
 * page's real content in hidden divs and moves it into place with a script, and aria-hidden text is
 * still on screen.
 */
function isNavigation(tag: Tag): boolean {
  return (tag.attrs.role ?? "").toLowerCase().split(/\s+/).includes("navigation");
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut to `max` UTF-16 code units, never ending on half of a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const out = text.slice(0, max);
  return /[\ud800-\udbff]$/.test(out) ? out.slice(0, -1) : out;
}

export function pageText(input: string, contentType: "text/html" | "text/plain"): string {
  if (contentType === "text/plain") return cut(tidy(input.replace(/\r\n?/g, "\n")), MAX_PAGE_TEXT);

  const html = input;
  let title = "";
  let description = "";
  const headings: string[] = [];
  let body = "";
  let heading: string | null = null;
  let inTitle = false;
  /** Elements open outside any skip, by name: a skip ends when one of them closes. */
  const open = new Map<string, number>();
  /**
   * While skipping an element: its name, and the elements opened inside it (by name, and in all),
   * so an end tag closes the innermost match first, as a browser does.
   */
  let skip: { name: string; inner: Map<string, number>; innerTotal: number } | null = null;
  const bump = (counts: Map<string, number>, name: string, by: number) => {
    const next = (counts.get(name) ?? 0) + by;
    if (next > 0) counts.set(name, next);
    else counts.delete(name);
  };

  const text = (raw: string) => {
    if (skip || !raw) return;
    const decoded = decodeEntities(raw);
    if (inTitle) {
      title += decoded;
      return;
    }
    body += decoded;
    if (heading !== null) heading += decoded;
  };
  const endHeading = () => {
    if (heading === null) return;
    const h = cut(squash(heading), MAX_HEADING);
    if (h && headings.length < MAX_HEADINGS) headings.push(h);
    heading = null;
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      text(html.slice(i));
      break;
    }
    text(html.slice(i, lt));

    if (html.startsWith("<!--", lt)) {
      // From "<!" + 2 so that "<!-->" and "<!--->" end where they start; "--!>" ends one too.
      // One forward search for whichever ending comes first keeps many comments linear.
      COMMENT_END.lastIndex = lt + 2;
      const end = COMMENT_END.exec(html);
      i = end ? end.index + end[0].length : html.length;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const close = html.indexOf(">", lt);
      i = close < 0 ? html.length : close + 1;
      continue;
    }

    const tag = parseTag(html, lt);
    if (tag === UNTERMINATED) break;
    if (tag === NOT_A_TAG) {
      text("<");
      i = lt + 1;
      continue;
    }
    i = tag.end;
    const { name, closing } = tag;
    const inForeign = skip !== null && FOREIGN.has(skip.name);
    // A self-closing slash counts only in svg and math (foreign content), as in HTML.
    const selfClosing = tag.selfClosing && (FOREIGN.has(name) || inForeign);
    const container = !VOID.has(name) && !selfClosing;

    // Raw text first, even inside a skipped element, so markup in scripts never counts.
    if (!closing && !selfClosing && RAW_TEXT_END.has(name)) {
      i = rawTextEnd(html, name, i);
      continue;
    }

    if (skip) {
      let ended = false;
      if (closing) {
        if ((skip.inner.get(name) ?? 0) > 0) {
          bump(skip.inner, name, -1);
          skip.innerTotal--;
        } else if (name === skip.name) {
          skip = null;
          continue;
        } else if (name === "body" || name === "html" || (open.get(name) ?? 0) > 0) {
          ended = true; // a parent closed it
        }
      } else if (skip.name === "p" && CLOSES_P.has(name)) ended = true;
      else if (name === skip.name && skip.innerTotal === 0 && SIBLING_CLOSES.has(name))
        ended = true;
      else if (container) {
        bump(skip.inner, name, 1);
        skip.innerTotal++;
      }
      if (!ended) continue;
      skip = null;
      // The tag that ended the skip belongs to the page: handle it below.
    }

    if (!closing && container && (SKIPPED.has(name) || isNavigation(tag))) {
      skip = { name, inner: new Map(), innerTotal: 0 };
      continue;
    }
    if (container) bump(open, name, closing ? -1 : 1);

    if (name === "title") {
      // Only the first title counts; a closing tag always ends it.
      inTitle = !closing && !title;
      continue;
    }
    if (name === "meta" && !closing) {
      const key = (tag.attrs.name ?? tag.attrs.property ?? "").toLowerCase();
      if (!description && (key === "description" || key === "og:description"))
        description = cut(squash(tag.attrs.content ?? ""), MAX_DESCRIPTION);
      continue;
    }

    if (HEADINGS.has(name)) {
      if (closing) endHeading();
      else {
        endHeading();
        heading = "";
      }
    } else if ((BLOCK.has(name) || CELLS.has(name)) && heading !== null) heading += " ";
    if (BLOCK.has(name)) body += "\n";
    else if (CELLS.has(name)) body += " ";
  }
  endHeading();

  const parts: string[] = [];
  const shownTitle = cut(squash(title), MAX_TITLE);
  if (shownTitle) parts.push(`Title: ${shownTitle}`);
  if (description) parts.push(`Description: ${description}`);
  if (headings.length) parts.push(`Headings:\n${headings.map((h) => `- ${h}`).join("\n")}`);
  const page = tidy(body);
  if (page) parts.push(`Page:\n${page}`);
  return cut(parts.join("\n\n"), MAX_PAGE_TEXT);
}
