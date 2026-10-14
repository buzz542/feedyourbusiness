#!/usr/bin/env node
// Claude Code PreToolUse hook (matcher: Bash).
// Blocks installing or running a package on the compliance denylist: scraping SDKs, vendor SDKs,
// stealth browser plugins. Exit 2 blocks the command and sends stderr back to Claude.
// This is a guard rail. The authoritative check is CI (npm run compliance:deps).
// Route C (docs/PLAN.md, D1) does not change this: the Reddit data vendor is called through its
// REST API with safeFetch(), so its SDK stays blocked.

import { installTargets, isBlockedPackage, loadDenylist } from "../../compliance/lib/denylist.mjs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let command = "";
try {
  command = String(JSON.parse(raw)?.tool_input?.command ?? "");
} catch {
  process.exit(0); // never block on input we cannot parse
}

const deny = loadDenylist();
const blocked = installTargets(command).filter((name) => isBlockedPackage(name, deny));

if (blocked.length > 0) {
  console.error(
    `Blocked: ${blocked.join(", ")} is on the compliance denylist (compliance/denylist.json).\n` +
      "AskedFor reaches sources only through safeFetch(): official APIs, and the contracted data vendor's REST API (docs/PLAN.md, section 2).\n" +
      "No scraping SDKs, vendor SDKs or browser automation. If this is a mistake, ask the founder. Do not work around the hook.",
  );
  process.exit(2);
}
process.exit(0);
