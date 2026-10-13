#!/usr/bin/env node
// Claude Code PreToolUse hook (matcher: Bash).
// Blocks installing or running a package on the compliance denylist: scraping SDKs, scraping
// services, stealth browser plugins. Exit 2 blocks the command and sends stderr back to Claude.
// This is a guard rail. The authoritative check is CI (npm run compliance:deps).

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
      "AskedFor never scrapes: official APIs and user-opened search links only (docs/BRIEF.md, Hard compliance rules).\n" +
      "If this is a mistake, ask the founder to change the brief on purpose. Do not work around the hook.",
  );
  process.exit(2);
}
process.exit(0);
