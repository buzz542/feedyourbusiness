import { facebook, indiehackers, linkedin, redditLinks, threads, xLinks } from "./link-sources";
import type { CollectSource, LinkSource, Source } from "./types";

/**
 * The only allowlist (docs/PLAN.md, "Sources").
 *
 * Link-mode sources only so far. The collect sources (hackernews, bluesky, reddit through the data
 * vendor, x through the official API) are added by the Collection milestone, each after its hosts,
 * auth and terms are confirmed against the current docs. Until then no host is allowed, and
 * safeFetch() refuses every request.
 */
export const sources: readonly Source[] = [
  redditLinks,
  linkedin,
  facebook,
  threads,
  indiehackers,
  xLinks,
];

type Env = Readonly<Record<string, string | undefined>>;

export function killSwitchName(source: Pick<Source, "id">): string {
  return `SOURCE_${source.id.toUpperCase()}_ENABLED`;
}

/**
 * Kill switch. Collect sources are off unless SOURCE_<ID>_ENABLED is exactly "true".
 * Link sources are on unless it is exactly "false". A source can be paused in minutes by
 * changing an env var if its terms change.
 */
export function isEnabled(source: Source, env: Env = process.env): boolean {
  const value = env[killSwitchName(source)];
  return source.mode === "collect" ? value === "true" : value !== "false";
}

export function enabledSources(env: Env = process.env): Source[] {
  return sources.filter((s) => isEnabled(s, env));
}

export function collectSources(env: Env = process.env): CollectSource[] {
  return enabledSources(env).filter((s): s is CollectSource => s.mode === "collect");
}

export function linkSources(env: Env = process.env): LinkSource[] {
  return enabledSources(env).filter((s): s is LinkSource => s.mode === "link");
}

/** Hosts safeFetch may call right now: the union over enabled collect sources. */
export function allowedHosts(env: Env = process.env): string[] {
  return [...new Set(collectSources(env).flatMap((s) => s.allowedHosts))];
}

/** Every host any source declares, enabled or not. Used by the static hosts gate. */
export function declaredHosts(): string[] {
  const hosts = sources.flatMap((s) => [
    ...s.allowedHosts,
    ...(s.mode === "link" ? s.linkHosts : []),
    new URL(s.termsUrl).hostname,
  ]);
  return [...new Set(hosts)];
}
