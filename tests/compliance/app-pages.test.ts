import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { walk } from "../../compliance/lib/finding";

/**
 * Layouts do not re-run on client-side navigation, so every page under /app must gate itself:
 * `requireAppPage("<its path>")` (signed in, allowlisted, terms accepted). Only `/app` (which routes
 * by nextStepFor) and `/app/terms` use `requireAccount` instead.
 */
const ROOT = "src/app/(app)/app";
const EXEMPT: Record<string, string> = {
  [`${ROOT}/page.tsx`]: "requireAccount(",
  [`${ROOT}/terms/page.tsx`]: "requireAccount(",
};

function findUngatedPages(files: { file: string; source: string }[]): string[] {
  return files.flatMap(({ file, source }) => {
    const exempt = EXEMPT[file];
    if (exempt) return source.includes(exempt) ? [] : [file];
    const path = "/app" + file.slice(ROOT.length).replace(/\/page\.tsx$/, "");
    return source.includes(`requireAppPage("${path}")`) ? [] : [file];
  });
}

/** Server actions and route handlers under /app are reachable without the page: they gate too. */
function findUngatedHandlers(files: { file: string; source: string }[]): string[] {
  return files
    .filter(({ source }) => !/require(AppPage|Account)\(/.test(source))
    .map(({ file }) => file);
}

describe("every /app server action and route handler gates itself", () => {
  it("each one calls requireAppPage or requireAccount", () => {
    const files = walk(ROOT)
      .filter((f) => /\/(actions|route)\.tsx?$/.test(f))
      .map((file) => ({ file, source: readFileSync(file, "utf8") }));
    expect(files.length).toBeGreaterThan(0);
    expect(findUngatedHandlers(files)).toEqual([]);
  });

  it("catches a planted action without a gate", () => {
    expect(
      findUngatedHandlers([
        {
          file: `${ROOT}/onboarding/actions.ts`,
          source: '"use server"; export async function a() {}',
        },
      ]),
    ).toEqual([`${ROOT}/onboarding/actions.ts`]);
  });
});

describe("every /app page gates itself", () => {
  it("finds the pages", () => {
    expect(walk(ROOT).filter((f) => f.endsWith("/page.tsx")).length).toBeGreaterThan(3);
  });

  it("each page calls requireAppPage with its own path", () => {
    const files = walk(ROOT)
      .filter((f) => f.endsWith("/page.tsx"))
      .map((file) => ({ file, source: readFileSync(file, "utf8") }));
    expect(findUngatedPages(files)).toEqual([]);
  });

  it("catches a planted page without the gate, or with another page's path", () => {
    expect(
      findUngatedPages([
        { file: `${ROOT}/rivals/page.tsx`, source: "export default function P() { return null; }" },
        { file: `${ROOT}/build/page.tsx`, source: 'await requireAppPage("/app/reply");' },
        { file: `${ROOT}/terms/page.tsx`, source: "no gate" },
      ]),
    ).toEqual([`${ROOT}/rivals/page.tsx`, `${ROOT}/build/page.tsx`, `${ROOT}/terms/page.tsx`]);
  });
});
