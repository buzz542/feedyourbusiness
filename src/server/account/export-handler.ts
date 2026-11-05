import { json } from "@/server/http/respond";
import { buildAccountExport, type ExportSource } from "./export";

export interface ExportDeps {
  getUser(): Promise<{ id: string; email: string | null } | null>;
  /** Reads through the user's own client, so RLS keeps every other account out. */
  load(userId: string, email: string | null): Promise<ExportSource>;
  now(): Date;
  log?: (message: string) => void;
}

/**
 * GET /api/export (docs/PLAN.md 4.2, 10.7). A read with no side effects, so it needs no origin
 * check; the session cookie decides whose data it is.
 */
export function createExportHandler(deps: ExportDeps) {
  return async (): Promise<Response> => {
    const user = await deps.getUser();
    if (!user) return json(401, { error: "unauthenticated" });
    try {
      const now = deps.now();
      const body = buildAccountExport(await deps.load(user.id, user.email), now);
      const day = now.toISOString().slice(0, 10);
      return json(200, body, {
        "content-disposition": `attachment; filename="askedfor-export-${day}.json"`,
      });
    } catch (error) {
      (deps.log ?? console.error)(
        `[export] failed: ${error instanceof Error ? error.name : "UnknownError"}`,
      );
      return json(500, { error: "export_unavailable" });
    }
  };
}
