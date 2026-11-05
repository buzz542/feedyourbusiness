/**
 * Read every row of a query page by page. It moves on by the rows each page returned and stops at
 * an empty page, so a server row cap smaller than `pageSize` (PostgREST's max-rows) never cuts the
 * result short. `limit` bounds the total.
 */
export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 1000,
  limit = 100_000,
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < limit) {
    const page = await fetchPage(rows.length, rows.length + pageSize - 1);
    if (page.length === 0) break;
    rows.push(...page);
  }
  return rows.slice(0, limit);
}
