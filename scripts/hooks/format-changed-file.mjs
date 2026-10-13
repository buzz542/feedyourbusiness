#!/usr/bin/env node
// Claude Code PostToolUse hook (matcher: Edit|Write|MultiEdit).
// Formats the changed file with Prettier, then runs a fast ESLint pass on TypeScript files.
// Lint errors exit 2 so Claude sees them and fixes them in the same turn.

import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let file = "";
try {
  file = String(JSON.parse(raw)?.tool_input?.file_path ?? "");
} catch {
  process.exit(0);
}

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const rel = path.relative(root, path.resolve(root, file));
const SKIP = [
  /^node_modules\//,
  /^\.next\//,
  /^docs\/BRIEF\.md$/,
  /^src\/types\/database\.ts$/,
  /^supabase\/migrations\//,
  /^package-lock\.json$/,
  /^\.\./,
];
if (!file || SKIP.some((re) => re.test(rel)) || !/\.(tsx?|mts|mjs|json|css|md)$/.test(rel))
  process.exit(0);

const bin = (name) => path.join(root, "node_modules", ".bin", name);
if (!existsSync(bin("prettier"))) process.exit(0); // dependencies not installed yet

spawnSync(bin("prettier"), ["--write", "--log-level", "silent", rel], { cwd: root });

if (/\.(tsx?|mts)$/.test(rel) && existsSync(bin("eslint"))) {
  const lint = spawnSync(bin("eslint"), ["--fix", rel], { cwd: root, encoding: "utf8" });
  if (lint.status !== 0) {
    console.error(
      `ESLint found problems in ${rel}:\n${(lint.stdout + lint.stderr).trim().split("\n").slice(0, 30).join("\n")}`,
    );
    process.exit(2);
  }
}
process.exit(0);
