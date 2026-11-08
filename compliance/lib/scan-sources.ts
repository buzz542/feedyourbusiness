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

const isTest = (file: string) => /\.test\.tsx?$/.test(file);

/**
 * A collect source's module files: `src/sources/<id>.ts` and `src/sources/<id>-*.ts`, plus every
 * file they import by a relative, `@/sources/` or `@/lib/` path, followed transitively and in any
 * subdirectory, so a helper module cannot hide a host from the scan. Never a test. `files` is every
 * file under `src/` (walk), and an import that resolves to none of them is reported in `problems`
 * rather than skipped. Other `@/` imports are refused in a source module (findSourceImports, strict).
 */
export function sourceModuleFiles(
  id: string,
  files: readonly string[],
  read?: (file: string) => string,
  problems: Finding[] = [],
): string[] {
  const own = new RegExp(`^src/sources/${id}(-[a-z0-9-]+)?\\.ts$`);
  const found = new Set(files.filter((f) => own.test(f) && !isTest(f)));
  const queue = read ? [...found] : [];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    for (const { specifier, line } of followedImports(read!(file), file)) {
      const target = resolveImport(file, specifier, files);
      if (!target)
        problems.push({
          file,
          line,
          rule: "source-import",
          detail: `"${specifier}" resolves to no file the gate can read`,
        });
      else if (!isTest(target) && !found.has(target)) {
        found.add(target);
        queue.push(target);
      }
    }
  }
  return [...found].sort();
}

const FOLLOWED = /^(\.{1,2}\/|@\/(sources|lib)\/)/;

/** The relative, `@/sources/` and `@/lib/` specifiers a file imports or re-exports. */
function followedImports(code: string, file: string): { specifier: string; line: number }[] {
  const sf = parse(code, file);
  const out: { specifier: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      FOLLOWED.test(node.moduleSpecifier.text)
    )
      out.push({ specifier: node.moduleSpecifier.text, line: lineOf(sf, node) });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function resolveImport(from: string, specifier: string, files: readonly string[]): string | null {
  const parts = specifier.startsWith("@/") ? ["src"] : from.split("/").slice(0, -1);
  const rest = specifier.startsWith("@/") ? specifier.slice(2) : specifier;
  for (const segment of rest.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  const base = parts.join("/");
  return (
    [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base].find((f) => files.includes(f)) ?? null
  );
}

function parse(code: string, file: string): ts.SourceFile {
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

const lineOf = (sf: ts.SourceFile, node: ts.Node) =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

const isOwnPath = (specifier: string) =>
  specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("@/");

/**
 * `strict` is for a collect source's own module files: they may import `@/lib/` helpers and other
 * `@/sources/` modules, never `@/server/` (where safeFetch, the fetch builders and fetchOwnSite
 * live), so a source cannot build a fetch for another source's host. Its ctx.fetch is the only way.
 */
export function findSourceImports(
  code: string,
  file: string,
  deny: Denylist,
  options: { strict?: boolean } = {},
): Finding[] {
  const sf = parse(code, file);
  const findings: Finding[] = [];
  const add = (node: ts.Node, detail: string) =>
    findings.push({ file, line: lineOf(sf, node), rule: "source-import", detail });

  const check = (node: ts.Node, specifier: string) => {
    if (options.strict && specifier.startsWith("@/") && !/^@\/(lib|sources)\//.test(specifier)) {
      add(node, `"${specifier}": a source module may import only @/lib/ and @/sources/`);
      return;
    }
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
export function findSourceHosts(
  code: string,
  file: string,
  own: ReadonlySet<string>,
  /** Hosts refused whatever their top-level domain (platforms, proxies, mirrors): isPlatformHost. */
  refused: (host: string) => boolean = () => false,
): Finding[] {
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
      const dotted = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text);
      if (dotted && (looksLikeHost(text) || refused(text)) && !own.has(text))
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
