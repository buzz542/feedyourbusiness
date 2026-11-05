import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * For page tests: every sentence of every list item and paragraph of a public page is in a row of
 * docs/claims.md in its exact wording (.claude/rules/copy.md), not only the sentences with numbers.
 * Returns the blocks, and the sentences that have no row.
 */
export function unclaimedBlocks(
  html: string,
  tags: readonly ("li" | "p")[] = ["li", "p"],
): { blocks: string[]; missing: string[] } {
  const claims = readFileSync(path.resolve(import.meta.dirname, "../../docs/claims.md"), "utf8");
  const cells = claims
    .split("\n")
    .filter((l) => l.startsWith("| "))
    .map((l) => (l.split("|")[2] ?? "").replace(/\\\|/g, "|"));
  const pattern = new RegExp(`<(${tags.join("|")})(?:\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`, "g");
  const blocks = [...html.matchAll(pattern)].map((m) =>
    m[2]!
      .replace(/<[^>]+>/g, "")
      .replace(/&#x27;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim(),
  );
  // Each sentence of each block must appear in one claim cell; a row may hold one sentence.
  const sentences = blocks.flatMap((b) => b.split(/(?<=[.!?:])\s+(?=[A-Z])/));
  return { blocks, missing: sentences.filter((t) => !cells.some((c) => c.includes(t))) };
}
