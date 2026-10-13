import { facebook, indiehackers, linkedin, reddit, threads, xLinks } from "./link-sources";
import type { CollectSource, LinkSource, Source } from "./types";

/**
 * The only allowlist (docs/BRIEF.md, "Source module contract").
 *
 * M0 ships link-mode sources only. Bluesky and Hacker News are added in M2, and the first M2 task
 * is to confirm their hosts and auth rules against the current docs before listing them here.
 * Until then no host is allowed, and safeFetch() refuses every request.
 */
export const sources: readonly Source[] = [
  reddit,
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
