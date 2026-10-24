/**
 * The visible text of the user's own page for the onboarding draft (docs/PLAN.md 8.3): title,
 * meta description, headings and body; scripts, styles and navigation removed; at most 30,000
 * characters. Small enough to write by hand (5.3: no HTML parser dependency). The page is the
 * user's own site and the output only goes to the model, so this aims for readable, not perfect.
 */

export const MAX_PAGE_TEXT = 30_000;

/** Elements whose content is never visible text, or is navigation. */
const DROPPED = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "object",
  "canvas",
  "nav",
  "header",
  "footer",
  "select",
  "button",
];

const BLOCK =
  /<\/?(p|div|br|li|ul|ol|h[1-6]|section|article|main|aside|tr|td|th|table|blockquote|dd|dt|dl|figure|figcaption|pre|hr)\b[^>]*>/gi;

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  middot: "\u00b7",
  bull: "\u2022",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

const clean = (s: string) =>
  decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

function dropElements(html: string): string {
  let out = html.replace(/<!--[\s\S]*?(-->|$)/g, " ");
  for (const tag of DROPPED) {
    // A closed element, then an unclosed one, which runs to the end of the page.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"), " ");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, "gi"), " ");
  }
  // Elements marked as navigation by role, one level deep.
  out = out.replace(/<(\w+)\b[^>]*\brole=["']?navigation["']?[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  return out;
}

export function extractPageText(source: string, contentType = "text/html"): string {
  if (contentType === "text/plain")
    return source
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_PAGE_TEXT);

  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(source)?.[1] ?? "");
  const description = clean(
    /<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=["']([^"']*)["'][^>]*>/i.exec(
      source,
    )?.[1] ??
      /<meta\b[^>]*\bcontent=["']([^"']*)["'][^>]*\bname=["']description["'][^>]*>/i.exec(
        source,
      )?.[1] ??
      "",
  );

  const bodyHtml =
    /<body\b[^>]*>([\s\S]*)/i.exec(source)?.[1] ??
    source.replace(/<head\b[\s\S]*?<\/head\s*>/i, "");
  const body = decodeEntities(
    dropElements(bodyHtml)
      .replace(BLOCK, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  const parts = [
    title ? `Title: ${title}` : "",
    description ? `Description: ${description}` : "",
    body,
  ].filter(Boolean);
  return parts.join("\n\n").slice(0, MAX_PAGE_TEXT);
}
