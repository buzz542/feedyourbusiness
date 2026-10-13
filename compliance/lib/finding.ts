import { readdirSync } from "node:fs";
import path from "node:path";

export interface Finding {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

export const formatFindings = (findings: Finding[]): string =>
  findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.detail}`).join("\n");

/** Recursively list files under `root` (relative to `cwd`), skipping heavy or generated folders. */
export function walk(root: string, cwd: string = process.cwd()): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".next", ".git", "coverage"]);
  const visit = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(path.join(cwd, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) visit(rel);
      else out.push(rel);
    }
  };
  visit(root);
  return out;
}

export const isTestFile = (file: string): boolean =>
  /\.test\.(ts|tsx)$/.test(file) || file.startsWith("tests/") || file.includes("/fakes.");
