import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The Claude Code hooks are code too. These run them the way Claude Code does: JSON on stdin. */
const run = (script: string, input: unknown, env: Record<string, string> = {}) =>
  spawnSync("node", [script], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

describe("deny-denylisted-installs hook", () => {
  const hook = "scripts/hooks/deny-denylisted-installs.mjs";
  const bash = (command: string) => run(hook, { tool_name: "Bash", tool_input: { command } });

  it.each([
    "npm install puppeteer",
    "npm i -D playwright-extra",
    "pnpm add apify-client@3",
    "npx puppeteer-extra-plugin-stealth",
    "cd app && yarn add @brightdata/sdk",
    "pip install selenium scrapy_splash",
    "bun add snoowrap",
  ])("blocks (exit 2) and explains: %s", (command) => {
    const result = bash(command);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("compliance denylist");
  });

  it.each([
    "npm install zod",
    "npm install",
    "npm run build",
    "npm i -D @playwright/test",
    "pip install -r requirements.txt",
    "git commit -m 'remove puppeteer'",
    "echo puppeteer",
    "ls",
  ])("allows: %s", (command) => {
    expect(bash(command).status).toBe(0);
  });

  it("never blocks on input it cannot parse", () => {
    expect(run(hook, "not json").status).toBe(0);
    expect(run(hook, {}).status).toBe(0);
  });
});

describe("stop-check hook", () => {
  const hook = path.resolve("scripts/hooks/stop-check.mjs");

  it("does not re-run when Claude is already continuing because of it", () => {
    expect(run(hook, { stop_hook_active: true }).status).toBe(0);
  });

  it("can be skipped explicitly", () => {
    expect(run(hook, {}, { SKIP_STOP_CHECK: "1" }).status).toBe(0);
  });

  it("does nothing when dependencies are not installed", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "askedfor-hook-"));
    expect(run(hook, {}, { CLAUDE_PROJECT_DIR: empty }).status).toBe(0);
  });

  it("blocks the stop (exit 2) and shows the failure when the check fails", () => {
    const project = mkdtempSync(path.join(tmpdir(), "askedfor-hook-"));
    writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ scripts: { check: "echo BOOM && exit 1" } }),
    );
    spawnSync("mkdir", [path.join(project, "node_modules")]);
    const result = run(hook, {}, { CLAUDE_PROJECT_DIR: project });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("npm run check is failing");
    expect(result.stderr).toContain("BOOM");
  });

  it("lets the turn end when the check passes", () => {
    const project = mkdtempSync(path.join(tmpdir(), "askedfor-hook-"));
    writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ scripts: { check: "exit 0" } }),
    );
    spawnSync("mkdir", [path.join(project, "node_modules")]);
    expect(run(hook, {}, { CLAUDE_PROJECT_DIR: project }).status).toBe(0);
  });
});

describe("format-changed-file hook", () => {
  const hook = "scripts/hooks/format-changed-file.mjs";

  it("ignores files it must not touch and unparseable input", () => {
    for (const file_path of [
      "docs/BRIEF.md",
      "src/types/database.ts",
      "supabase/migrations/x.sql",
      "../outside.ts",
      "image.png",
    ]) {
      expect(run(hook, { tool_input: { file_path } }).status).toBe(0);
    }
    expect(run(hook, "garbage").status).toBe(0);
  });
});
