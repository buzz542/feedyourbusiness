#!/usr/bin/env node
// Claude Code SessionStart hook. In cloud sessions the container starts without node_modules, so
// install them once. This is what lets tests, linters and `npm run check` run in the session.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (process.env.CLAUDE_CODE_REMOTE !== "true") process.exit(0);
if (!existsSync("package-lock.json") || existsSync("node_modules/.package-lock.json"))
  process.exit(0);

const result = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], { stdio: "inherit" });
process.exit(result.status ?? 0);
