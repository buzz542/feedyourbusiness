import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Classification } from "@/server/classify/schema";
import { CLASSIFY_SYSTEM } from "@/server/classify/prompt";
import { Draft, DRAFT_SYSTEM } from "@/server/onboarding/draft";
import { REPLY_TIPS } from "@/server/reply/tips";

/**
 * D8: no model ever writes reply text (docs/PLAN.md 2.2.2). The modules that call the model are
 * exactly draft, classify, synthesize and preview; no model schema has a field that could carry a
 * reply; no prompt asks for one; reply tips are fixed copy in code.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const ALLOWED_TASKS = new Set(["draft", "classify", "synthesize", "preview"]);
const REPLY_FIELD = /repl|respon|messag|comment|answer|draft_text|wording/i;
const ASKS_FOR_REPLY =
  /\b(write|draft|compose|suggest|generate)\b[^.]{0,40}\b(reply|replies|response|comment)\b/i;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Files that make a model call (an object literal passed to callStructured) and their tasks. */
export function modelCalls(sourceFiles: { file: string; text: string }[]) {
  return sourceFiles
    .filter((f) => /callStructured\(\{/.test(f.text))
    .map((f) => ({
      file: f.file,
      tasks: [...f.text.matchAll(/task:\s*"([a-z_]+)"/g)].map((m) => m[1]!),
    }));
}

const fieldNames = (schema: z.ZodType): string[] => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object")
      for (const [k, v] of Object.entries(node)) {
        if (k === "properties" && v && typeof v === "object") out.push(...Object.keys(v));
        walk(v);
      }
  };
  walk(z.toJSONSchema(schema));
  return out;
};

/** A sentence that asks for reply text, unless it forbids it. */
const asksForReply = (prompt: string) =>
  prompt
    .split(/(?<=[.!?])\s+/)
    .some((s) => ASKS_FOR_REPLY.test(s) && !/\bnever\b|\bnot\b|\bno\b/i.test(s));

describe("D8: no model writes reply text", () => {
  const source = files(path.join(ROOT, "src")).map((file) => ({
    file: path.relative(ROOT, file),
    text: readFileSync(file, "utf8"),
  }));

  it("calls the model only from the draft and classify modules, with allowed tasks", () => {
    const calls = modelCalls(source);
    expect(calls.map((c) => c.file).sort()).toEqual([
      "src/server/classify/classifier.ts",
      "src/server/onboarding/draft.ts",
    ]);
    for (const call of calls) for (const task of call.tasks) expect(ALLOWED_TASKS).toContain(task);
  });

  it("catches a planted model call with another task", () => {
    const planted = modelCalls([
      { file: "src/server/reply/suggest.ts", text: 'llm.callStructured({ task: "reply" })' },
    ]);
    expect(planted[0]!.tasks.filter((t) => !ALLOWED_TASKS.has(t))).toEqual(["reply"]);
  });

  it("gives no model schema a field that could carry reply text", () => {
    for (const schema of [Draft, Classification])
      expect(fieldNames(schema).filter((f) => REPLY_FIELD.test(f))).toEqual([]);
    expect(
      fieldNames(z.object({ suggested_reply: z.string() })).filter((f) => REPLY_FIELD.test(f)),
    ).toEqual(["suggested_reply"]);
  });

  it("has no prompt that asks for a reply", () => {
    for (const prompt of [DRAFT_SYSTEM, CLASSIFY_SYSTEM]) expect(asksForReply(prompt)).toBe(false);
    expect(asksForReply("Then write a short reply the maker can post.")).toBe(true);
    expect(CLASSIFY_SYSTEM).toContain("You never write replies");
  });

  it("keeps reply tips as fixed copy for every category", () => {
    expect(Object.keys(REPLY_TIPS).sort()).toEqual([
      "looking_for_tool",
      "mentions_competitor",
      "mentions_you",
      "pain_point",
      "wish",
    ]);
    for (const tip of Object.values(REPLY_TIPS)) expect(tip.length).toBeGreaterThan(20);
  });
});
