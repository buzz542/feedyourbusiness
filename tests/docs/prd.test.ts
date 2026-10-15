import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The kickoff prompt says: copy the "Hard compliance rules" section into the PRD unchanged.
 * Rules may only change by editing the brief on purpose, never by drift in a derived document.
 */
const section = (markdown: string): string => {
  const start = markdown.indexOf("\n## Hard compliance rules") + 1;
  const end = markdown.indexOf("\n## ", start + 5) + 1 || markdown.length;
  return markdown.slice(start, end).trimEnd();
};

describe("docs/PRD.md", () => {
  const brief = readFileSync("docs/BRIEF.md", "utf8");
  const prd = readFileSync("docs/PRD.md", "utf8");

  it("carries the brief's hard compliance rules byte for byte", () => {
    const rules = section(brief);
    expect(rules.length).toBeGreaterThan(5000);
    expect(rules).toContain("Product Hunt is not a data source");
    expect(section(prd)).toBe(rules);
  });

  it("points at the findings document it depends on", () => {
    expect(prd).toContain("docs/PHASE0-FINDINGS.md");
  });
});

/** Plan sections by heading, from the heading to the next `## `. */
const planSection = (markdown: string, heading: string): string => {
  const start = markdown.indexOf(`\n## ${heading}`) + 1;
  const end = markdown.indexOf("\n## ", start + 5) + 1 || markdown.length;
  return markdown.slice(start, end).trimEnd();
};

/**
 * The decisions and hard rules in force. They change only with the founder's approval: whoever edits
 * sections 1 or 2 updates this hash in the same commit and says in the commit message that the
 * founder approved the change (CLAUDE.md, "Ask before you").
 */
const PINNED_RULES_SHA256 = "dc59e28b5a3c4090d94e74e3268a65f891cd1d349f5f16be40c60d24536cad65";

describe("docs/PLAN.md", () => {
  const plan = readFileSync("docs/PLAN.md", "utf8");

  it("pins sections 1 and 2 (decisions and hard rules) against unapproved edits", () => {
    const pinned = `${planSection(plan, "1. Decisions")}\n\n${planSection(plan, "2. Hard rules (route C)")}`;
    expect(pinned.length).toBeGreaterThan(10_000);
    expect(createHash("sha256").update(pinned).digest("hex")).toBe(PINNED_RULES_SHA256);
  });

  it("records every decision and the route C hard rules", () => {
    for (let d = 1; d <= 12; d++) expect(plan, `D${d}`).toContain(`- **D${d}. `);
    expect(plan).toContain("## 2. Hard rules (route C)");
  });

  it("is what CLAUDE.md and the compliance reviewer point to", () => {
    expect(readFileSync("CLAUDE.md", "utf8")).toContain("docs/PLAN.md");
    expect(readFileSync(".claude/agents/compliance-reviewer.md", "utf8")).toContain("docs/PLAN.md");
  });
});

describe("docs/TASKS.md", () => {
  const tasks = readFileSync("docs/TASKS.md", "utf8");

  it("has a goal line and at least one task for every milestone M0 to M9", () => {
    for (let m = 0; m <= 9; m++) {
      const block = tasks.split(new RegExp(`^## M${m} `, "m"))[1]?.split(/^## M\d /m)[0] ?? "";
      expect(block, `M${m} section`).toContain(`/goal Milestone M${m} in docs/TASKS.md`);
      expect(block.match(/^- \[[ x]\] /gm)?.length ?? 0, `M${m} tasks`).toBeGreaterThan(0);
    }
  });
});
