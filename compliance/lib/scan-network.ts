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
 * fetchOwnSite (docs/PLAN.md 12.3) needs a custom DNS lookup on every connection, which fetch
 * cannot do, so this one file may import node:https and node:dns, with static imports it never
 * exports. Nothing else, and no other file.
 */
export const OWN_SITE_FILE = "src/server/net/own-site.ts";
const OWN_SITE_MODULES = new Set(["https", "dns"]);

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

  // Names own-site.ts binds from node:https and node:dns; it may use them, never export them.
  const ownSiteBindings = new Set<string>();

  const checkModule = (node: ts.Node, specifier: string) => {
    const name = moduleName(specifier);
    if (file === OWN_SITE_FILE && OWN_SITE_MODULES.has(name) && ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.name) ownSiteBindings.add(clause.name.text);
      const named = clause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) ownSiteBindings.add(named.name.text);
      if (named && ts.isNamedImports(named))
        for (const el of named.elements) ownSiteBindings.add(el.name.text);
      return;
    }
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
      checkModule(node, node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkModule(node, node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expr = node.moduleReference.expression;
      if (ts.isStringLiteral(expr)) checkModule(node, expr.text);
    }

    const exported =
      ts.isExportSpecifier(node) && !node.parent.parent.moduleSpecifier
        ? (node.propertyName ?? node.name)
        : ts.isExportAssignment(node)
          ? node.expression
          : null;
    if (exported && ts.isIdentifier(exported) && ownSiteBindings.has(exported.text)) {
      add(
        node,
        "banned-network-module",
        `exports "${exported.text}", a node:https or node:dns binding.`,
      );
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

/**
 * Fonts are self-hosted (docs/PLAN.md 9.3): no next/font/google, which fetches from Google at
 * build time and names a third-party host, and no remote url() or @import in a stylesheet.
 */
export function findRemoteFonts(code: string, file: string): Finding[] {
  const findings: Finding[] = [];
  code.split("\n").forEach((text, i) => {
    const line = i + 1;
    if (/\.(css|scss)$/.test(file)) {
      if (/(?:url\(\s*["']?|@import\s+["'])\s*(?:https?:)?\/\//i.test(text))
        findings.push({
          file,
          line,
          rule: "remote-font-or-style",
          detail: "stylesheet loads a remote URL; self-host fonts and styles",
        });
    } else if (
      /from\s+["']next\/font\/google["']|import\(\s*["']next\/font\/google["']/.test(text)
    ) {
      findings.push({
        file,
        line,
        rule: "remote-font-or-style",
        detail: "next/font/google fetches from a font CDN; use a self-hosted package",
      });
    }
  });
  return findings;
}
