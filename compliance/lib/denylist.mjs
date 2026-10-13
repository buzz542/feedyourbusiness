// Shared by the compliance gates (TypeScript, run by vitest) and the Claude Code PreToolUse
// hook (plain Node). Kept as dependency-free ESM so both can import it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @returns {import("./denylist.d.mts").Denylist} */
export function loadDenylist(file = path.join(here, "..", "denylist.json")) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Normalise a package specifier to its bare name.
 *   "foo@1.2.3" -> "foo", "@scope/foo@latest" -> "@scope/foo", "npm:foo@1" -> "foo".
 * Python names are lower-cased with "_" folded to "-", and extras and version pins are dropped.
 * @param {string} spec
 */
export function packageName(spec) {
  let s = spec
    .trim()
    .replace(/^npm:/, "")
    .replace(/^["']|["']$/g, "");
  if (
    !s ||
    s.startsWith(".") ||
    s.startsWith("/") ||
    /^[a-z]+:\/\//i.test(s) ||
    /^(github|gitlab|git\+)/i.test(s)
  )
    return null;
  s = s.replace(/\[[^\]]*\]/g, "").split(/[=<>!~;]/)[0] ?? s;
  const at = s.startsWith("@") ? s.indexOf("@", 1) : s.indexOf("@");
  if (at > 0) s = s.slice(0, at);
  return s.toLowerCase().replace(/_/g, "-");
}

/**
 * @param {string} name
 * @param {import("./denylist.d.mts").Denylist} deny
 */
export function isBlockedPackage(name, deny) {
  const n = packageName(name);
  if (!n) return false;
  if (deny.packages.blocked.includes(n)) return true;
  const scope = n.startsWith("@") ? n.split("/")[0] : null;
  return scope !== null && deny.packages.blockedScopes.includes(scope);
}

const TOOLS = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "pnpx",
  "bunx",
  "pip",
  "pip3",
  "uv",
  "poetry",
  "pipx",
  "cargo",
  "go",
  "gem",
]);
const INSTALL_VERBS = new Set(["install", "i", "add", "dlx", "exec", "x", "get", "require"]);
const RUNNERS = new Set(["npx", "pnpx", "bunx"]);

/**
 * Package names a shell command would install or run. Handles chains (&&, ;, |), env prefixes
 * and flags. A deliberately simple parser: the hook is a guard rail, CI is the enforcement.
 * @param {string} command
 * @returns {string[]}
 */
export function installTargets(command) {
  const targets = [];
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const start = tokens.findIndex((t) => TOOLS.has(t));
    if (start === -1) continue;
    const tool = tokens[start];
    const rest = tokens.slice(start + 1);
    if (RUNNERS.has(tool)) {
      targets.push(...rest.filter((t) => !t.startsWith("-")).slice(0, 1));
      continue;
    }
    // `pip install -r file` and `npm install --save-dev x`: skip flags, keep names.
    const verbAt = rest.findIndex((t) => INSTALL_VERBS.has(t));
    if (verbAt === -1) continue;
    const after = rest.slice(verbAt + 1);
    for (let i = 0; i < after.length; i++) {
      const t = after[i];
      if (t === "-r" || t === "--requirement" || t === "-e" || t === "--editable") {
        i++;
        continue;
      }
      if (!t.startsWith("-")) targets.push(t);
    }
  }
  return targets;
}
