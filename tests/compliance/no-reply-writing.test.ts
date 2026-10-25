import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { walk } from "../../compliance/lib/finding";

/**
 * D8: no model ever writes reply text. The modules that call the model are exactly the onboarding
 * draft, classification, the weekly synthesis and the instant preview, and none of their prompts
 * asks for a reply. Reply tips are fixed copy (src/lib/reply-tips.ts).
 */

const ALLOWED_TASKS = new Set(["draft", "classify", "synthesize", "preview"]);
const REPLY_WRITING =
  /\b(write|draft|compose|generate|suggest)\b[^.]{0,40}\b(a |the )?(reply|replies|response|comment|answer)\b/i;

/** True when the text asks for a reply, not counting "never write a reply" and the like. */
function asksForReply(source: string): boolean {
  const re = new RegExp(REPLY_WRITING.source, "gi");
  for (const m of source.matchAll(re)) {
    const before = source.slice(Math.max(0, m.index - 20), m.index);
    if (!/\b(never|not|no|don't|do not)\s+(\w+\s+)?$/i.test(before)) return true;
  }
  return false;
}

function modelCallers(files: { file: string; source: string }[]) {
  return files
    .filter(
      (f) => /\bcallStructured\s*(<[^>]*>)?\s*\(/.test(f.source) && !f.file.endsWith("/llm/llm.ts"),
    )
    .map((f) => ({
      file: f.file,
      tasks: [...f.source.matchAll(/task:\s*"([a-z_]+)"/g)].map((m) => m[1]!),
    }));
}

function findViolations(files: { file: string; source: string }[]): string[] {
  const problems: string[] = [];
  for (const caller of modelCallers(files)) {
    if (caller.tasks.length === 0) problems.push(`${caller.file}: model call without a task`);
    for (const task of caller.tasks)
      if (!ALLOWED_TASKS.has(task)) problems.push(`${caller.file}: task ${task}`);
  }
  // Every file that calls the model, plus every prompt-like file, is scanned for reply requests.
  const callerFiles = new Set(modelCallers(files).map((c) => c.file));
  for (const f of files)
    if (
      (callerFiles.has(f.file) ||
        /\/(prompt|draft|synth|preview|classify)[^/]*\.tsx?$/.test(f.file)) &&
      asksForReply(f.source)
    )
      problems.push(`${f.file}: a prompt asks for reply text`);
  return problems;
}

const sources = () =>
  walk("src")
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));

describe("D8: no model writes replies", () => {
  it("only draft, classify, synthesize and preview call the model, and no prompt asks for a reply", () => {
    expect(findViolations(sources())).toEqual([]);
  });

  it("finds the model callers it expects", () => {
    const tasks = new Set(modelCallers(sources()).flatMap((c) => c.tasks));
    expect(tasks.has("draft")).toBe(true);
    expect(tasks.has("classify")).toBe(true);
  });

  it("scans the prompt of any model caller, whatever its file name", () => {
    expect(
      findViolations([
        {
          file: "src/server/reply/hints.ts",
          source:
            'llm.callStructured({ task: "classify", system: "Then draft a reply for the user." })',
        },
      ]),
    ).toEqual(["src/server/reply/hints.ts: a prompt asks for reply text"]);
  });

  it("catches a planted reply writer and a planted prompt", () => {
    expect(
      findViolations([
        { file: "src/server/reply/writer.ts", source: 'llm.callStructured({ task: "reply" })' },
        {
          file: "src/server/classify/prompt.ts",
          source: "Then write a short reply the user can paste.",
        },
      ]),
    ).toEqual([
      "src/server/reply/writer.ts: task reply",
      "src/server/classify/prompt.ts: a prompt asks for reply text",
    ]);
  });
});
