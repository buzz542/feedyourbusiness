import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { Denylist } from "./denylist.mjs";
import { isTestFile, walk, type Finding } from "./finding";

/**
 * `compliance:copy`: scans marketing pages and emails for what the brief forbids.
 *   * em dashes, hype words, competitor names, UK spellings (US English is the standard)
 *   * any number that is not in docs/claims.md (every public number must be provable)
 *   * third-party logo files in public/
 * App UI (`appScanRoots`) gets every rule but the numbers rule (docs/PLAN.md 3.2).
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

/**
 * `allowedNumbers` null turns the numbers rule off. App UI uses that: its numbers come from the
 * user's own live data, which are not public claims (.claude/rules/copy.md).
 */
export function checkCopy(
  items: readonly CopyItem[],
  file: string,
  deny: Denylist,
  allowedNumbers: ReadonlySet<string> | null,
): Finding[] {
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
    if (allowedNumbers === null) continue;
    for (const m of text.matchAll(NUMBER)) {
      const n = m[0].replace(/,$/, "");
      if (!allowedNumbers.has(n))
        add(item, "unsourced-number", `contains "${n}", which is not in docs/claims.md`);
    }
  }
  return findings;
}

/**
 * "public": marketing pages and emails, where every rule applies, numbers included.
 * "app": signed-in UI and shared components, where every rule but the numbers rule applies.
 */
export type CopyScope = "public" | "app";

const underRoot = (file: string, root: string): boolean =>
  file === root || file.startsWith(`${root.replace(/\/$/, "")}/`);

/** `file` is repo-relative. Backslashes are folded so a Windows path cannot escape its scope. */
export function copyScopeOf(file: string, deny: Denylist): CopyScope | null {
  const f = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (deny.copy.scanRoots.some((root) => underRoot(f, root))) return "public";
  if (deny.copy.appScanRoots.some((root) => underRoot(f, root))) return "app";
  return null;
}

/** Every root the copy gate reads, from both scopes. A root may be a folder or a single file. */
export const copyScanRoots = (deny: Denylist): string[] => [
  ...deny.copy.scanRoots,
  ...deny.copy.appScanRoots,
];

/** The files `compliance:copy` scans, relative to `cwd`. */
export function copyGateFiles(deny: Denylist, cwd: string = process.cwd()): string[] {
  return copyScanRoots(deny)
    .flatMap((root) => walk(root, cwd))
    .filter((f) => !isTestFile(f) && /\.(tsx?|mdx?)$/.test(f));
}

/** The whole gate: read every scanned file under `cwd` and apply its scope's rules. */
export function runCopyGate(
  deny: Denylist,
  claimNumbersAllowed: ReadonlySet<string>,
  cwd: string = process.cwd(),
): Finding[] {
  return copyGateFiles(deny, cwd).flatMap((file) =>
    scanCopyFile(file, readFileSync(path.join(cwd, file), "utf8"), deny, claimNumbersAllowed),
  );
}

/**
 * UI files that no scope covers: any .tsx under src/app (route handlers in src/app/api aside) or
 * src/components. A new route group or a root page such as not-found.tsx must be given a scope.
 */
export function unscopedUiFiles(deny: Denylist, cwd: string = process.cwd()): string[] {
  return [...walk("src/app", cwd), ...walk("src/components", cwd)].filter(
    (f) =>
      f.endsWith(".tsx") &&
      !isTestFile(f) &&
      !f.startsWith("src/app/api/") &&
      copyScopeOf(f, deny) === null,
  );
}

/** Scan one file with the rules for its scope. Files outside every scan root yield nothing. */
export function scanCopyFile(
  file: string,
  source: string,
  deny: Denylist,
  claimNumbersAllowed: ReadonlySet<string>,
): Finding[] {
  const scope = copyScopeOf(file, deny);
  if (scope === null) return [];
  const items = /\.mdx?$/.test(file)
    ? source.split("\n").map((text, i) => ({ text, line: i + 1 }))
    : extractCopy(source, file);
  return checkCopy(items, file, deny, scope === "public" ? claimNumbersAllowed : null);
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
