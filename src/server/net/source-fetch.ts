import { isEnabled } from "@/sources/registry";
import type { CollectSource } from "@/sources/types";
import { createSafeFetch } from "./safe-fetch";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * A collect source's ctx.fetch (docs/PLAN.md 2.1.9, 7.1): safeFetch bound to that source's own
 * allowedHosts only, so one source can never call another source's host. The kill switch is read
 * on every request, so turning a source off stops it mid-run.
 */
export function createSourceFetch(
  source: CollectSource,
  options: { env?: Env; fetchImpl?: typeof globalThis.fetch } = {},
) {
  const env = options.env ?? process.env;
  return createSafeFetch({
    getAllowedHosts: () => (isEnabled(source, env) ? source.allowedHosts : []),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
