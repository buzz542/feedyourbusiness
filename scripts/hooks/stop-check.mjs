#!/usr/bin/env node
// Claude Code Stop hook. Optional by design (docs/BRIEF.md): no turn should end on a red build.
// Runs `npm run check`. If it fails, exit 2 keeps Claude working with the failure in front of it.
//
// Guards against loops and noise:
//   * stop_hook_active: Claude is already continuing because of this hook, so let it stop.
//   * dependencies not installed: nothing meaningful to run.
//   * SKIP_STOP_CHECK=1: an explicit escape hatch for conversation-only sessions.

import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let active = false;
try {
  active = Boolean(JSON.parse(raw)?.stop_hook_active);
} catch {
  /* treat unparseable input as not active */
}

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
if (active || process.env.SKIP_STOP_CHECK === "1" || !existsSync(path.join(root, "node_modules")))
  process.exit(0);

const result = spawnSync("npm", ["run", "check", "--silent"], {
  cwd: root,
  encoding: "utf8",
  timeout: 9 * 60 * 1000,
});
if (result.status === 0) process.exit(0);

const tail = (result.stdout + result.stderr).trim().split("\n").slice(-60).join("\n");
console.error(`npm run check is failing. Fix it before stopping.\n\n${tail}`);
process.exit(2);
