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
 * The single file allowed to open its own connections: the fetch of the user's own site, which
 * resolves every address itself to refuse private ones (docs/PLAN.md 12.3). It may import these
 * modules and nothing else from the banned list, and may not re-export them.
 */
export const OWN_SITE_FILE = "src/server/net/own-site.ts";
export const OWN_SITE_MODULES: ReadonlySet<string> = new Set(["https", "dns"]);

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

  const isOwnSite = file === OWN_SITE_FILE;

  const checkModule = (node: ts.Node, specifier: string, reexport = false) => {
    const name = moduleName(specifier);
    // The exception covers importing the modules, never handing them on to other files.
    if (isOwnSite && !reexport && OWN_SITE_MODULES.has(name)) return;
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
      checkModule(node, node.moduleSpecifier.text, true);
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

/**
 * No server tools (docs/PLAN.md 8.1): every model call is a plain request with our own input, so
 * nothing the model does can reach the web or run code for us. Reports any tool type with a date
 * suffix (`web_search_20260209`, `code_execution_20260521` and the rest), MCP fields, the Agent
 * SDK's web tools and the Agent SDK itself, and, in a file that imports the Anthropic SDK, any
 * `tools`, `tool_choice` or `container` property.
 */
const SERVER_TOOL_TYPE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)*_\d{8}\b/;
const SERVER_TOOL_NAMES = new Set(["mcp_servers", "mcp_toolset", "WebSearch", "WebFetch"]);
const TOOL_PROPERTIES = new Set(["tools", "tool_choice", "container"]);
const AGENT_SDK = "@anthropic-ai/claude-agent-sdk";

export function findServerTools(code: string, file: string): Finding[] {
  const sf = parse(code, file);
  const findings: Finding[] = [];
  const add = (node: ts.Node, detail: string) =>
    findings.push({
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      rule: "server-tool",
      detail,
    });

  let importsSdk = false;
  const specifiers = (node: ts.Node): string | null => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      return node.moduleSpecifier.text;
    if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamic) && first && ts.isStringLiteralLike(first)) return first.text;
    }
    return null;
  };
  const findImports = (node: ts.Node) => {
    const spec = specifiers(node);
    if (spec?.startsWith("@anthropic-ai/sdk")) importsSdk = true;
    if (spec?.startsWith(AGENT_SDK))
      add(node, `imports ${AGENT_SDK}; model calls go through src/server/llm`);
    ts.forEachChild(node, findImports);
  };
  findImports(sf);

  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const text = node.text;
      if (SERVER_TOOL_TYPE.test(text))
        add(node, `names a server tool type ("${text.slice(0, 40)}")`);
      else if (SERVER_TOOL_NAMES.has(text)) add(node, `names "${text}"`);
    } else if (ts.isIdentifier(node) && SERVER_TOOL_NAMES.has(node.text)) {
      add(node, `names "${node.text}"`);
    } else if (
      importsSdk &&
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      TOOL_PROPERTIES.has(node.name.text)
    ) {
      add(node, `passes "${node.name.text}" to the model`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

/** The only files that may name the data vendor's host (docs/PLAN.md 2.1.9). */
const VENDOR_HOST_FILES = /^src\/sources\/reddit[^/]*\.ts$/;
// Also catches the host written with escaped dots, as in a regex literal.
const VENDOR_HOST = /brightdata\\?\.com/i;

/** Every line outside src/sources/reddit*.ts that names the vendor's host, comments included. */
export function findVendorHostOutsideReddit(text: string, file: string): Finding[] {
  if (VENDOR_HOST_FILES.test(file.replaceAll("\\", "/"))) return [];
  return text.split("\n").flatMap((line, i) =>
    VENDOR_HOST.test(line)
      ? [
          {
            file,
            line: i + 1,
            rule: "vendor-host",
            detail: "The data vendor's host may appear only in src/sources/reddit*.ts",
          },
        ]
      : [],
  );
}
