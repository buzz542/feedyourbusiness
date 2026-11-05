import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * For page tests: every list item and paragraph of a public page has a row in docs/claims.md with
 * its exact wording (.claude/rules/copy.md), not only the sentences with numbers. Returns the
 * blocks that have none.
 */
export function unclaimedBlocks(html: string): { blocks: string[]; missing: string[] } {
  const claims = readFileSync(path.resolve(import.meta.dirname, "../../docs/claims.md"), "utf8");
  const cells = claims
    .split("\n")
    .filter((l) => l.startsWith("| "))
    .map((l) => (l.split("|")[2] ?? "").replace(/\\\|/g, "|"));
  const blocks = [...html.matchAll(/<(li|p)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)].map((m) =>
    m[2]!
      .replace(/<[^>]+>/g, "")
      .replace(/&#x27;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return { blocks, missing: blocks.filter((b) => !cells.some((c) => c.includes(b))) };
}
