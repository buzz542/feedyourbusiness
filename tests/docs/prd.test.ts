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

describe("docs/TASKS.md", () => {
  const tasks = readFileSync("docs/TASKS.md", "utf8");

  it("has a goal line and at least one task for every milestone M0 to M7", () => {
    for (let m = 0; m <= 7; m++) {
      const block = tasks.split(new RegExp(`^## M${m} `, "m"))[1]?.split(/^## M\d /m)[0] ?? "";
      expect(block, `M${m} section`).toContain(`/goal Milestone M${m} in docs/TASKS.md`);
      expect(block.match(/^- \[[ x]\] /gm)?.length ?? 0, `M${m} tasks`).toBeGreaterThan(0);
    }
  });
});
