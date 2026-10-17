import ts from "typescript";
import type { Finding } from "./finding";

/**
 * Static half of the `compliance:hosts` gate.
 *
 * Application code may reach the network only through safeFetch(). This scanner reads the
 * TypeScript AST (so comments and strings cannot trip it, and aliasing cannot dodge it) and
 * reports: any reference to the global `fetch`, HTTP-capable modules, raw sockets, and URL
 * literals on hosts that are not expected.
 */

/** The single file allowed to reference the global fetch: it is the wrapper itself. */
export const FETCH_WRAPPER_FILE = "src/server/net/safe-fetch.ts";

/**
 * fetchOwnSite() (docs/PLAN.md 12.3) opens its own guarded connections, so this one file may import
 * node:https and node:dns, and nothing else on the banned list.
 */
export const OWN_SITE_FILE = "src/server/net/own-site.ts";
const OWN_SITE_MODULES = new Set(["https", "dns"]);
/**
 * fetchOwnSite() reaches any public https URL, so only the onboarding draft and the instant preview
 * may call it (type-only imports are fine anywhere). Anything else fetches through safeFetch().
 */
export const OWN_SITE_IMPORTERS = ["src/server/onboarding/", "src/server/preview/"] as const;
const OWN_SITE_MODULE = OWN_SITE_FILE.replace(/\.ts$/, "");

/** The repo path a specifier points at ("@/x" and relative forms), without its extension. */
function resolveSpecifier(file: string, specifier: string): string {
  let target = specifier;
  if (specifier.startsWith("@/")) target = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) {
    const parts = file.split("/").slice(0, -1);
    for (const part of specifier.split("/")) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }
    target = parts.join("/");
  }
  return target.replace(/\.(ts|tsx|js|mjs)$/, "");
}

const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"]);
const NETWORK_CONSTRUCTORS = new Set([
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "WebTransport",
]);

function parse(code: string, file: string): ts.SourceFile {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
}

/** "node:https" -> "https", "got/dist/x" -> "got", "@a/b/c" -> "@a/b". */
export function moduleName(specifier: string): string {
  const bare = specifier.replace(/^node:/, "");
  const parts = bare.split("/");
  return bare.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? bare);
}

/** True if this identifier names the global `fetch` rather than a property, parameter or type. */
function isGlobalFetchReference(node: ts.Identifier): boolean {
  if (node.text !== "fetch") return false;
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent)) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) return parent.name !== node;
  if (ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent))
    return parent.name !== node;
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) {
    return parent.name !== node;
  }
  if (
    ts.isFunctionDeclaration(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent)
  )
    return false;
  if (ts.isTypeQueryNode(parent)) return false;
  return true;
}

export function findNetworkPrimitives(
  code: string,
  file: string,
  bannedModules: readonly string[],
): Finding[] {
  const sf = parse(code, file);
  const banned = new Set(bannedModules);
  const findings: Finding[] = [];
  const isWrapper = file === FETCH_WRAPPER_FILE;

  const add = (node: ts.Node, rule: string, detail: string) =>
    findings.push({
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      rule,
      detail,
    });

  /** `staticImport`: a plain import declaration, the only form the own-site exception covers. */
  const checkModule = (
    node: ts.Node,
    specifier: string,
    { staticImport = false, typeOnly = false } = {},
  ) => {
    if (
      !typeOnly &&
      file !== OWN_SITE_FILE &&
      file !== OWN_SITE_FILE.replace(/\.ts$/, ".test.ts") &&
      !OWN_SITE_IMPORTERS.some((dir) => file.startsWith(dir)) &&
      resolveSpecifier(file, specifier) === OWN_SITE_MODULE
    ) {
      add(
        node,
        "own-site-importer",
        `uses fetchOwnSite(), which only ${OWN_SITE_IMPORTERS.join(" and ")} may call`,
      );
    }
    const name = moduleName(specifier);
    if (staticImport && file === OWN_SITE_FILE && OWN_SITE_MODULES.has(name)) return;
    if (banned.has(name)) {
      add(
        node,
        "banned-network-module",
        `imports "${specifier}". Use safeFetch() from src/server/net.`,
      );
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      checkModule(node, node.moduleSpecifier.text, {
        staticImport: true,
        typeOnly: node.importClause?.isTypeOnly === true,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkModule(node, node.moduleSpecifier.text, { typeOnly: node.isTypeOnly });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expr = node.moduleReference.expression;
      if (ts.isStringLiteral(expr)) checkModule(node, expr.text);
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const first = node.arguments[0];
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamicImport) && first && ts.isStringLiteralLike(first)) {
        checkModule(node, first.text);
      }
    }

    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      NETWORK_CONSTRUCTORS.has(node.expression.text)
    ) {
      add(node, "raw-network-api", `new ${node.expression.text}() bypasses safeFetch()`);
    }

    if (!isWrapper) {
      if (ts.isIdentifier(node) && isGlobalFetchReference(node)) {
        add(
          node,
          "global-fetch",
          "references the global fetch. Use safeFetch() from src/server/net.",
        );
      } else if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "fetch" &&
        ts.isIdentifier(node.expression) &&
        GLOBAL_OBJECTS.has(node.expression.text)
      ) {
        add(
          node,
          "global-fetch",
          `references ${node.expression.text}.fetch. Use safeFetch() from src/server/net.`,
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return findings;
}

const URL_HOST = /https?:\/\/([A-Za-z0-9.-]+)/g;

/** Hosts named in string literals, plus URL templates whose host is built at runtime. */
export function findUrlHosts(code: string, file: string): { host: string | null; line: number }[] {
  const sf = parse(code, file);
  const out: { host: string | null; line: number }[] = [];

  const scan = (node: ts.Node, text: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    for (const match of text.matchAll(URL_HOST))
      out.push({ host: (match[1] ?? "").toLowerCase().replace(/\.$/, ""), line });
    // `https://${host}/` ends the head literal right after the scheme: a dynamic host.
    if (/https?:\/\/$/.test(text)) out.push({ host: null, line });
  };

  const visit = (node: ts.Node) => {
    const inImport =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined;
    if (inImport) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      scan(node, node.text);
    } else if (ts.isJsxText(node)) {
      scan(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function findUnexpectedHosts(
  code: string,
  file: string,
  allowed: ReadonlySet<string>,
): Finding[] {
  return findUrlHosts(code, file).flatMap(({ host, line }) => {
    // fetchOwnSite() exists to fetch the user's own URL, so own-site.ts alone may build one.
    if (host === null && file === OWN_SITE_FILE) return [];
    if (host === null) {
      return [
        {
          file,
          line,
          rule: "dynamic-url-host",
          detail: "URL built with a runtime host. Hosts must be literals.",
        },
      ];
    }
    return allowed.has(host)
      ? []
      : [
          {
            file,
            line,
            rule: "unexpected-host",
            detail: `URL on host "${host}", which is not on any allowlist`,
          },
        ];
  });
}
