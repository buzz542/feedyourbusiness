/**
 * The visible text of the user's own page for the onboarding draft (docs/PLAN.md 8.3): title,
 * meta description, headings and body; scripts, styles and navigation removed; at most 30,000
 * characters. Small enough to write by hand (5.3: no HTML parser dependency). The page is the
 * user's own site and the output only goes to the model, so this aims for readable, not perfect.
 *
 * One forward pass that never looks back: a crafted page (up to fetchOwnSite's 2 MB) cannot make it
 * slow. Regular expressions run only over a single tag's own text, or search forward from where the
 * pass stands, never from every position in the page.
 */

export const MAX_PAGE_TEXT = 30_000;

/** Elements whose content is never visible text, or is navigation. */
const DROPPED = new Set([
  "head",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "object",
  "canvas",
  // Not "header": a hero heading often sits in it. Navigation inside it still goes.
  "nav",
  "footer",
  "select",
  "button",
  "textarea",
]);

/** Content is not markup: jump straight to the closing tag. */
const RAW_TEXT = new Set(["script", "style", "noscript", "iframe", "textarea", "title", "xmp"]);

/** Never have content or a closing tag. */
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
  "param",
  "source",
  "track",
  "wbr",
]);

/** May sit in <head>; any other opening tag ends a head that was never closed, as in a browser. */
const HEAD_CONTENT = new Set([
  "title",
  "meta",
  "link",
  "style",
  "script",
  "base",
  "noscript",
  "template",
]);

/** Start a new line in the text. */
const BLOCK = new Set([
  "p",
  "div",
  "br",
  "li",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "section",
  "article",
  "main",
  "aside",
  "tr",
  "td",
  "th",
  "table",
  "blockquote",
  "dd",
  "dt",
  "dl",
  "figure",
  "figcaption",
  "pre",
  "hr",
]);

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
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const surrogate = code >= 0xd800 && code <= 0xdfff;
      return code > 0 && code <= 0x10ffff && !surrogate ? String.fromCodePoint(code) : " ";
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

/** Title and attribute text are not markup: decode and tidy, never strip "tags". */
const clean = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: string;
  /** Index just past the closing ">". */
  end: number;
}

const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isNameChar = (c: number) => isLetter(c) || (c >= 48 && c <= 57) || c === 45 || c === 58;
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;

/**
 * Read the tag that starts at `<` in position i. "text" when the `<` is ordinary text, "skip" with
 * an end for a declaration, comment-like or bogus tag, null when it never ends (the rest of the
 * page is then not visible text). A quote opens only right after `=`, as in a browser, so a `>`
 * inside a quoted value does not end the tag.
 */
function readTag(html: string, i: number): Tag | "text" | { skip: number } | null {
  const next = html.charCodeAt(i + 1);
  const closing = next === 47; // "/"
  const nameStart = closing ? i + 2 : i + 1;
  if (!isLetter(html.charCodeAt(nameStart))) {
    if (!closing && next !== 33 && next !== 63) return "text"; // not "<!" or "<?"
    const end = html.indexOf(">", i);
    return end < 0 ? null : { skip: end + 1 };
  }
  let j = nameStart;
  while (j < html.length && isNameChar(html.charCodeAt(j))) j++;
  const name = html.slice(nameStart, j).toLowerCase();
  const attrsStart = j;
  let quote = 0;
  let afterEquals = false;
  for (; j < html.length; j++) {
    const c = html.charCodeAt(j);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 62) {
      break; // ">"
    } else if ((c === 34 || c === 39) && afterEquals) {
      quote = c;
    }
    if (!isSpace(c)) afterEquals = c === 61; // "="
  }
  if (j >= html.length) return null;
  const attrs = html.slice(attrsStart, j);
  return { name, closing, selfClosing: attrs.endsWith("/"), attrs, end: j + 1 };
}

function attribute(attrs: string, wanted: string): string | null {
  const pattern = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of attrs.matchAll(pattern)) {
    if (m[1]!.toLowerCase() === wanted) return m[2] ?? m[3] ?? m[4] ?? "";
  }
  return null;
}

const closers = new Map<string, RegExp>();
/** The index of the next closing tag for `name` at or after `from`, or -1. */
function findClosing(html: string, name: string, from: number): number {
  let re = closers.get(name);
  if (!re) {
    re = new RegExp(`</${name}(?=[\\s/>]|$)`, "gi");
    closers.set(name, re);
  }
  re.lastIndex = from;
  return re.exec(html)?.index ?? -1;
}

/** Open elements while inside dropped content, with a count per name so closing is O(1). */
class OpenElements {
  private readonly stack: string[] = [];
  private readonly counts = new Map<string, number>();
  get size() {
    return this.stack.length;
  }
  /** True when nothing but <head> is open (or nothing at all). */
  onlyHead() {
    return (this.counts.get("head") ?? 0) === this.stack.length;
  }
  push(name: string) {
    this.stack.push(name);
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }
  /** Close `name` and everything opened inside it; a stray closing tag changes nothing. */
  close(name: string) {
    if (!this.counts.get(name)) return;
    for (;;) {
      const top = this.stack.pop()!;
      this.counts.set(top, this.counts.get(top)! - 1);
      if (top === name) return;
    }
  }
  clear() {
    this.stack.length = 0;
    this.counts.clear();
  }
}

const ROLE_NAVIGATION = /(?:^|\s)role\s*=\s*["']?navigation(?:["'\s/]|$)/i;

export function extractPageText(source: string, contentType = "text/html"): string {
  if (contentType === "text/plain")
    return cap(
      source
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    );

  const text: string[] = [];
  const open = new OpenElements();
  let title = "";
  let description = "";
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    const textEnd = lt < 0 ? source.length : lt;
    if (open.size === 0 && textEnd > i) text.push(source.slice(i, textEnd));
    if (lt < 0) break;

    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      if (end < 0) break;
      if (open.size === 0) text.push(" ");
      i = end + 3;
      continue;
    }

    const tag = readTag(source, lt);
    if (tag === null) break;
    if (tag === "text") {
      if (open.size === 0) text.push("<");
      i = lt + 1;
      continue;
    }
    if ("skip" in tag) {
      i = tag.skip;
      continue;
    }
    i = tag.end;
    const { name } = tag;

    if (tag.closing) {
      open.close(name);
    } else {
      if (name === "body") open.clear();
      else if (open.size > 0 && open.onlyHead() && !HEAD_CONTENT.has(name)) open.clear();

      const inHead = open.onlyHead();
      if (RAW_TEXT.has(name)) {
        const close = findClosing(source, name, i);
        if (close < 0) break;
        if (name === "title" && inHead && !title) title = clean(source.slice(i, close));
        const end = source.indexOf(">", close);
        if (end < 0) break;
        i = end + 1;
        if (open.size === 0) text.push(" ");
        continue;
      }
      if (name === "meta" && inHead && !description) {
        if (attribute(tag.attrs, "name")?.toLowerCase() === "description")
          description = clean(attribute(tag.attrs, "content") ?? "");
      }
      if (!VOID.has(name) && !tag.selfClosing) {
        if (open.size > 0 || DROPPED.has(name) || ROLE_NAVIGATION.test(tag.attrs)) open.push(name);
      }
    }
    if (open.size === 0) text.push(BLOCK.has(name) ? "\n" : " ");
  }

  const body = decodeEntities(text.join(""))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  const parts = [
    title ? `Title: ${title}` : "",
    description ? `Description: ${description}` : "",
    body,
  ].filter(Boolean);
  return cap(parts.join("\n\n"));
}

/** At most MAX_PAGE_TEXT characters, never ending in half of a surrogate pair. */
function cap(text: string): string {
  const out = text.slice(0, MAX_PAGE_TEXT);
  const last = out.charCodeAt(out.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out;
}
