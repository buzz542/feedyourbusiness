import type { Condition } from "@/server/store/feed";

/** feedConditions as a SQL where clause and its parameters, as PostgREST applies them. */
export function feedSql(conditions: Condition[]) {
  const params: unknown[] = [];
  const where = conditions.map((c) => {
    params.push(c.value);
    const p = `$${params.length}`;
    switch (c.op) {
      case "eq":
        return `${c.column} = ${p}`;
      case "neq":
        return `${c.column} <> ${p}`;
      case "gte":
        return `${c.column} >= ${p}`;
      case "in":
        return `${c.column} = any(${p})`;
      case "ilike":
        return `${c.column} ilike ${p}`;
    }
  });
  return { where: where.join(" and "), params };
}
