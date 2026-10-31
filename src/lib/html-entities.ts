/**
 * HTML character references decoded for text taken out of HTML: page text for the onboarding draft
 * and post excerpts from sources. Dashes become hyphens and odd spaces plain spaces, as our copy
 * rules want. Linear time.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  middot: "·",
  bull: "·",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
      }
      return NAMED[code.toLowerCase()] ?? match;
    })
    .replace(/[\u2012-\u2015\u2212]/g, "-")
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ");
}
