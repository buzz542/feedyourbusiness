/**
 * The visible text of the user's product page, for the onboarding draft (docs/PLAN.md 8.3): title,
 * meta description, headings and body, with scripts, styles, navigation and hidden content removed,
 * at most 30,000 characters. A small single-pass tokenizer, so no HTML-parsing dependency is needed.
 * The page is untrusted (up to 2 MB from fetchOwnSite()), so every step is linear in its length.
 */

export const MAX_PAGE_TEXT = 30_000;
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 500;
const MAX_HEADING = 200;

/** Elements whose content is code or markup, never page text. Skipped up to their closing tag. */
const RAW_TEXT = ["script", "style", "noscript", "template", "textarea", "xmp"] as const;
/** Elements skipped with everything inside them: navigation, chrome and embedded graphics. */
const SKIPPED = new Set(["nav", "footer", "svg", "math", "iframe", "object", "select", "dialog"]);
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
  "div",
  "dl",
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
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);
const HEADINGS = new Set(["h1", "h2", "h3"]);

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
  times: "×",
  euro: "€",
  pound: "£",
};

/** What HTML maps numeric references 0x80 to 0x9F to (Windows-1252), per the HTML standard. */
const C1_REPLACEMENTS: Readonly<Record<number, number>> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

/**
 * A numeric reference as HTML decodes it. Zero, surrogates and anything past U+10FFFF become
 * U+FFFD, so no lone surrogate reaches the prompt (the API rejects one in a JSON body).
 */
function fromCodePoint(code: number): string {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
  if (code >= 0x80 && code <= 0x9f) return String.fromCodePoint(C1_REPLACEMENTS[code] ?? 0xfffd);
  return String.fromCodePoint(code);
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      return fromCodePoint(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return Object.hasOwn(NAMED, body.toLowerCase()) ? NAMED[body.toLowerCase()]! : match;
  });
}

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

/** Content the page does not show: navigation landmarks and hidden elements. */
function hides(tag: Tag): boolean {
  const { role, hidden } = tag.attrs;
  return (
    role === "navigation" ||
    tag.attrs["aria-hidden"] === "true" ||
    (hidden !== undefined && hidden !== "until-found")
  );
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
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
  /** While skipping an element: its name and how deeply that name is nested inside it. */
  let skip: { name: string; depth: number } | null = null;

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
    if (h) headings.push(h);
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
      // From "<!" + 2 so that "<!-->" and "<!--->" end where they start.
      const close = html.indexOf("-->", lt + 2);
      i = close < 0 ? html.length : close + 3;
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
    const selfClosing = tag.selfClosing && FOREIGN.has(name);

    // Raw text first, even inside a skipped element, so markup in scripts never counts.
    if (!closing && RAW_TEXT_END.has(name)) {
      i = rawTextEnd(html, name, i);
      continue;
    }

    if (skip) {
      if (closing && (name === "body" || name === "html")) skip = null;
      else if (skip.name === "p" && !closing && CLOSES_P.has(name)) skip = null;
      else {
        if (name === skip.name && !VOID.has(name) && !selfClosing) {
          skip.depth += closing ? -1 : 1;
          if (skip.depth === 0) skip = null;
        }
        continue;
      }
      if (closing) continue;
    }

    if (!closing && !VOID.has(name) && !selfClosing && (SKIPPED.has(name) || hides(tag))) {
      skip = { name, depth: 1 };
      continue;
    }

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
