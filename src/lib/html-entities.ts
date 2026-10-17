/**
 * HTML character references decoded the way browsers do (the common named ones, and numeric ones
 * with HTML's rules), for text taken out of HTML: page text for the onboarding draft and post
 * excerpts from sources.
 */

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
  times: "\u00d7",
  euro: "\u20ac",
  pound: "\u00a3",
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
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\ufffd";
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
