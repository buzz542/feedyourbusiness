import ts from "typescript";
import type { Denylist } from "./denylist.mjs";
import type { Finding } from "./finding";

/**
 * `compliance:copy`: scans marketing pages, emails and app UI for what the brief forbids.
 *   * em dashes, hype words, competitor names, UK spellings (US English is the standard)
 *   * any number that is not in docs/claims.md (every public number must be provable). Not
 *     applied to app UI, where numbers are live data rather than claims.
 *   * third-party logo files in public/
 *
 * Copy is extracted from the TypeScript AST: JSX text plus user-facing string literals. Class
 * names, URLs, imports and similar plumbing are skipped, so Tailwind classes do not trip it.
 */

export interface CopyItem {
  text: string;
  line: number;
}

/** JSX attributes and object keys whose string values are plumbing, not words a reader sees. */
const NON_COPY_ATTRS = new Set([
  "className",
  "class",
  "href",
  "src",
  "id",
  "key",
  "type",
  "rel",
  "target",
  "name",
  "htmlFor",
  "role",
  "method",
  "action",
  "autoComplete",
  "inputMode",
  "lang",
  "dir",
  "style",
  "viewBox",
  "d",
  "fill",
  "stroke",
  "xmlns",
  "width",
  "height",
  "sizes",
  "loading",
  "decoding",
  "crossOrigin",
  "referrerPolicy",
  "tabIndex",
  "data-testid",
]);
const NON_COPY_KEYS = new Set([
  "className",
  "href",
  "src",
  "url",
  "path",
  "slug",
  "id",
  "key",
  "type",
  "name",
  "locale",
  "timeZone",
  "dateStyle",
  "timeStyle",
  "style",
  "currency",
  "format",
  "display",
  "variable",
  "subsets",
  "weight",
  "rel",
  "target",
  "method",
]);

function propertyKey(node: ts.Node): string | null {
  const parent = node.parent;
  if (parent && ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const name = parent.name;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  }
  return null;
}

export function extractCopy(code: string, file: string): CopyItem[] {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  const items: CopyItem[] = [];

  const push = (node: ts.Node, text: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t)
      items.push({ text: t, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
      return;

    if (ts.isJsxText(node)) {
      push(node, node.text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const isDirective = ts.isExpressionStatement(parent);
      const isElementAccess =
        ts.isElementAccessExpression(parent) && parent.argumentExpression === node;
      const isCaseLabel = ts.isCaseClause(parent) || ts.isLiteralTypeNode(parent);
      const attr = ts.isJsxAttribute(parent) ? parent.name.getText(sf) : null;
      const key = propertyKey(node);
      const skip =
        isDirective ||
        isElementAccess ||
        isCaseLabel ||
        (attr !== null && NON_COPY_ATTRS.has(attr)) ||
        (key !== null && NON_COPY_KEYS.has(key)) ||
        (ts.isCallExpression(parent) && /^(require|import)$/.test(parent.expression.getText(sf)));
      if (!skip) push(node, node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      push(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return items;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
};

/**
 * Decode HTML entities. JSX must escape apostrophes (react/no-unescaped-entities), so real copy says
 * `don&apos;t`; decoding means rules match what a reader sees, and `&mdash;` counts as an em dash.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_match, body: string) => {
    if (body.startsWith("#")) {
      const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? " ";
  });
}

/** Remove HTML tags and decode entities, so markup in email templates is not read as numbers. */
const stripMarkup = (text: string): string => decodeEntities(text.replace(/<[^>]*>/g, " "));

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/**
 * Numbers that appear in the "Exact claim" column of the register table. Prose elsewhere in the
 * file (rules, examples) never counts, so writing a number in the rules cannot approve it.
 */
export function claimNumbers(claimsMarkdown: string): Set<string> {
  const numbers = new Set<string>();
  for (const line of claimsMarkdown.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator row
    for (const m of (cells[1] ?? "").matchAll(NUMBER)) numbers.add(m[0].replace(/,$/, ""));
  }
  return numbers;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Matches at a word start but not at a word end, so "unlock" also catches "unlocks" and "unlocking". */
const wordRegex = (phrase: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase)}`, "iu");

export interface CheckCopyOptions {
  /** Every number must be a claim. True for public pages and emails, false for app UI. */
  numbers?: boolean;
}

export function checkCopy(
  items: readonly CopyItem[],
  file: string,
  deny: Denylist,
  allowedNumbers: ReadonlySet<string>,
  options: CheckCopyOptions = {},
): Finding[] {
  const checkNumbers = options.numbers ?? true;
  const findings: Finding[] = [];
  const add = (item: CopyItem, rule: string, detail: string) =>
    findings.push({
      file,
      line: item.line,
      rule,
      detail: `${detail} in "${item.text.slice(0, 70)}"`,
    });

  const banned = deny.copy.bannedPhrases.map((p) => [p, wordRegex(p)] as const);
  const competitors = deny.copy.competitorNames.map((p) => [p, wordRegex(p)] as const);
  const spellings = deny.copy.ukSpellings.map(
    (p) => [p, new RegExp(`(?<![\\p{L}])${escapeRegex(p)}`, "iu")] as const,
  );

  for (const item of items) {
    const text = stripMarkup(item.text);
    if (text.includes("\u2014")) add(item, "em-dash", "contains an em dash");
    for (const [phrase, re] of banned)
      if (re.test(text)) add(item, "banned-phrase", `uses the banned phrase "${phrase}"`);
    for (const [name, re] of competitors)
      if (re.test(text)) add(item, "competitor-name", `names the competitor "${name}"`);
    for (const [word, re] of spellings)
      if (re.test(text))
        add(item, "uk-spelling", `uses the UK spelling "${word}". Use US English.`);
    if (!checkNumbers) continue;
    for (const m of text.matchAll(NUMBER)) {
      const n = m[0].replace(/,$/, "");
      if (!allowedNumbers.has(n))
        add(item, "unsourced-number", `contains "${n}", which is not in docs/claims.md`);
    }
  }
  return findings;
}

/** Flag logo files named after a platform. Platform names appear in text only. */
export function findLogoFiles(files: readonly string[], deny: Denylist): Finding[] {
  const exts = new Set(deny.logos.imageExtensions);
  return files.flatMap((file) => {
    const lower = file.toLowerCase();
    const ext = lower.slice(lower.lastIndexOf("."));
    if (!exts.has(ext)) return [];
    const base = lower.slice(lower.lastIndexOf("/") + 1, lower.lastIndexOf("."));
    const hit = deny.logos.forbiddenNames.find((n) => base.includes(n));
    return hit
      ? [
          {
            file,
            line: 1,
            rule: "third-party-logo",
            detail: `image named for "${hit}". No logos without written permission.`,
          },
        ]
      : [];
  });
}
