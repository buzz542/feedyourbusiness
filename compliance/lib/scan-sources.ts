import ts from "typescript";
import { isBlockedPackage, type Denylist } from "./denylist.mjs";
import type { Finding } from "./finding";
import { findUrlHosts, moduleName } from "./scan-network";

/**
 * Launch guards for collect source modules (the founder, 8 Nov 2026; docs/PLAN.md 2.1.6, 2.1.9).
 *
 * A collect source module may import only its own code (relative or `@/` paths), `zod` and
 * `server-only`: never a scraping SDK, a vendor SDK, a browser package or an HTTP client, whatever the
 * denylist says today. And it may name only its own hosts: the registry entry's `allowedHosts`,
 * `linkHosts`, terms and DPA pages, plus our own and standards hosts.
 */

/** The outside packages a collect source module may import. Nothing that opens connections. */
export const SOURCE_PACKAGES: ReadonlySet<string> = new Set(["zod", "server-only"]);

/** Packages that drive a browser: never in a source, whatever the denylist's dev-only list says. */
const BROWSER_PACKAGES = new Set(["playwright", "playwright-core", "@playwright/test"]);

/** `src/sources/<id>.ts` and `src/sources/<id>-*.ts`, never a test. */
export function sourceModuleFiles(id: string, files: readonly string[]): string[] {
  const own = new RegExp(`^src/sources/${id}(-[a-z0-9-]+)?\\.ts$`);
  return files.filter((f) => own.test(f) && !/\.test\.ts$/.test(f)).sort();
}

function parse(code: string, file: string): ts.SourceFile {
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

const lineOf = (sf: ts.SourceFile, node: ts.Node) =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

const isOwnPath = (specifier: string) =>
  specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("@/");

export function findSourceImports(code: string, file: string, deny: Denylist): Finding[] {
  const sf = parse(code, file);
  const findings: Finding[] = [];
  const add = (node: ts.Node, detail: string) =>
    findings.push({ file, line: lineOf(sf, node), rule: "source-import", detail });

  const check = (node: ts.Node, specifier: string) => {
    if (isOwnPath(specifier)) return;
    const name = moduleName(specifier);
    if (BROWSER_PACKAGES.has(name)) add(node, `"${name}" drives a browser`);
    else if (isBlockedPackage(name, deny)) add(node, `"${name}" is on the denylist`);
    else if (!SOURCE_PACKAGES.has(name)) add(node, `"${name}" is not a package a source may use`);
  };

  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      check(node, node.moduleSpecifier.text);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      if (ts.isStringLiteral(expr)) check(node, expr.text);
    }
    if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isImport || isRequire) {
        const arg = node.arguments[0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)))
          check(node, arg.text);
        else add(node, "dynamic import or require with a runtime name");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

const BARE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63})$/i;
/**
 * A bare string counts as a host when it ends in a country code or a common generic top-level
 * domain, so a query parameter such as `tweet.fields` is not one.
 */
const GENERIC_TLDS = new Set(
  "com net org io app dev ai co social xyz info biz me tv gg news cloud site online tech ly so sh to fm am network".split(
    " ",
  ),
);
const looksLikeHost = (text: string): boolean => {
  const tld = BARE_HOST.exec(text)?.[1]?.toLowerCase();
  return tld !== undefined && (tld.length === 2 || GENERIC_TLDS.has(tld));
};

/** Every host a source module names, in a URL or as a bare host string, must be its own. */
export function findSourceHosts(code: string, file: string, own: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = findUrlHosts(code, file).flatMap(({ host, line }) =>
    host !== null && own.has(host)
      ? []
      : [
          {
            file,
            line,
            rule: "source-host",
            detail:
              host === null
                ? "URL built with a runtime host"
                : `"${host}" is not in this source's registry entry`,
          },
        ],
  );
  const sf = parse(code, file);
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined
    )
      return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text.trim().toLowerCase();
      if (looksLikeHost(text) && !own.has(text))
        findings.push({
          file,
          line: lineOf(sf, node),
          rule: "source-host",
          detail: `"${text}" is not in this source's registry entry`,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}
