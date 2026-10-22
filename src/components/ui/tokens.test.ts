import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.2 contrast for the color tokens in globals.css (docs/PLAN.md 9.2), computed from the token
 * values themselves so a token change that breaks contrast fails here. Text pairs need 4.5:1.
 */

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function block(selector: RegExp): string {
  const m = selector.exec(css);
  if (!m) throw new Error(`no block for ${selector}`);
  return m[1] ?? "";
}

function tokens(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]!] = m[2]!;
  return out;
}

const light = tokens(block(/^:root\s*\{([^}]*)\}/m));
const dark = tokens(block(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** [text token, background token] pairs that appear in the UI. */
const TEXT_PAIRS: [string, string][] = [
  ["ink", "paper"],
  ["ink-muted", "paper"],
  ["accent", "paper"],
  ["accent-ink", "accent"],
  ["ink", "highlight"],
  ["positive", "paper"],
  ["negative", "paper"],
  ["ink", "surface"],
  ["ink-muted", "surface"],
  ["accent", "surface"],
  ["positive", "surface"],
  ["negative", "surface"],
];

describe("color tokens", () => {
  it("define the same tokens in both themes", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("include the highlighter, trend and surface tokens", () => {
    expect(light).toMatchObject({ highlight: "#f3dd6d" });
    expect(dark).toMatchObject({ highlight: "#6b5a12" });
    for (const t of ["positive", "negative", "surface"]) expect(light[t], t).toBeDefined();
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("every text pair reaches 4.5:1 in the %s theme", (_theme, theme) => {
    const failures = TEXT_PAIRS.flatMap(([fg, bg]) => {
      const a = theme[fg];
      const b = theme[bg];
      if (!a || !b) return [`${fg} on ${bg}: missing`];
      const ratio = contrast(a, b);
      return ratio >= 4.5 ? [] : [`${fg} on ${bg}: ${ratio.toFixed(2)}`];
    });
    expect(failures).toEqual([]);
  });

  it("computes known ratios correctly", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
