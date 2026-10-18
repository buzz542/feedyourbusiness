import { isHostAllowed } from "@/server/net/safe-fetch";
import { isPlatformWebHost } from "@/server/net/platform-hosts";
import { bluesky } from "./bluesky";
import { hackernews } from "./hackernews";
import { facebook, indiehackers, linkedin, redditLinks, threads, xLinks } from "./link-sources";
import { reddit } from "./reddit";
import { VENDOR_DOMAINS } from "./reddit-vendor";
import { x } from "./x";
import type { CollectSource, LinkSource, Source } from "./types";

/**
 * The only allowlist (docs/PLAN.md, "Sources").
 *
 * Collect sources are added in the Collection milestone (M3), each after its hosts, auth and terms
 * are confirmed against the current docs, and stay off until SOURCE_<ID>_ENABLED is "true". While
 * every collect source is off, no host is allowed and safeFetch() refuses every request.
 */
export const sources: readonly Source[] = [
  hackernews,
  bluesky,
  reddit,
  x,
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

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day as YYYY-MM-DD (2026-02-30 and 2026-13-01 are not). */
function isIsoDay(value: string | undefined): boolean {
  if (!value || !ISO_DAY.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/**
 * docs/PLAN.md 2.1.7: on a deployment (production or preview), a vendor source stays off until the
 * env var its vendor names holds the date the DPA, transfer mechanism and DPIA were done. Local runs
 * (development, and the founder's capture script) are not held back.
 */
export function vendorClearance(
  source: Source,
  env: Env = process.env,
): "not_vendor" | "cleared" | "dpa_missing" {
  if (source.mode !== "collect" || source.access !== "vendor_api") return "not_vendor";
  const deployed = env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
  if (!deployed) return "cleared";
  return source.vendor && isIsoDay(env[source.vendor.dpaSignedOnEnv]) ? "cleared" : "dpa_missing";
}

/**
 * Kill switch. Collect sources are off unless SOURCE_<ID>_ENABLED is exactly "true" (and, for a
 * vendor source on a deployment, its DPA date is set). Link sources are on unless it is exactly
 * "false". A source can be paused in minutes by changing an env var if its terms change.
 */
export function isEnabled(source: Source, env: Env = process.env): boolean {
  const value = env[killSwitchName(source)];
  if (source.mode === "link") return value !== "false";
  return value === "true" && vendorClearance(source, env) !== "dpa_missing";
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
    ...s.linkHosts,
    new URL(s.termsUrl).hostname,
  ]);
  return [...new Set(hosts)];
}

/** Platforms the hard rules say are never collected, by us or by a vendor (docs/PLAN.md 2.1). */
export const NEVER_COLLECTED = [
  "indiehackers",
  "linkedin",
  "facebook",
  "instagram",
  "tiktok",
  "threads",
  "youtube",
  "discord",
  "producthunt",
] as const;

const isHttps = (raw: string) => {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
};

const isVendorHost = (host: string) => {
  const h = host.toLowerCase().replace(/\.$/, "");
  return VENDOR_DOMAINS.some((domain) => h === domain || h.endsWith(`.${domain}`));
};

/** D4: Reddit and X posts are kept 7 days, the rest 30. */
const SEVEN_DAY_SOURCES = new Set(["reddit", "x"]);

/**
 * Every rule of the source contract (docs/PLAN.md 7.1, 2.1.9) that code can check, as messages.
 * Empty for a valid registry; the registry test runs it on the real list and on planted ones.
 */
export function registryProblems(list: readonly Source[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const collect = list.filter((s): s is CollectSource => s.mode === "collect");
  const fetchable = collect.flatMap((s) => s.allowedHosts);

  for (const source of list) {
    if (seen.has(source.id)) problems.push(`duplicate id ${source.id}`);
    seen.add(source.id);
    // safeFetch's own host check: a link host must be refused for every source's fetch.
    for (const host of source.linkHosts)
      if (isHostAllowed(host, fetchable))
        problems.push(`${source.id}: link host ${host} is fetchable`);
  }
  for (const source of collect) {
    const id = source.id;
    // By the platform name inside the id too: "linkedin_jobs" is LinkedIn.
    if (NEVER_COLLECTED.some((platform) => id.replaceAll("_", "").includes(platform)))
      problems.push(`${id} is never collected (docs/PLAN.md 2.1)`);
    // D1 and 2.1.9 by what a source calls, not by the label it gives itself.
    const vendorHosts = source.allowedHosts.filter(isVendorHost);
    if (vendorHosts.length > 0 && (id !== "reddit" || source.access !== "vendor_api"))
      problems.push(`${id}: only reddit, with access vendor_api, may call the vendor`);
    if (id === "reddit" && (source.access !== "vendor_api" || !source.vendor))
      problems.push(`reddit: must declare access vendor_api and its vendor (D1, D12)`);
    if (source.access === "vendor_api" && vendorHosts.length !== source.allowedHosts.length)
      problems.push(`${id}: a vendor source may call only the vendor's hosts`);
    if (source.access === "vendor_api") {
      if (id !== "reddit") problems.push(`${id}: only reddit may use a vendor (D1)`);
      if (!source.vendor) problems.push(`${id}: vendor_api needs a vendor`);
      else {
        if (!isHttps(source.vendor.dpaUrl))
          problems.push(`${id}: the vendor's DPA link must be https`);
        if (!/^[A-Z][A-Z0-9_]*_DPA_SIGNED_ON$/.test(source.vendor.dpaSignedOnEnv))
          problems.push(
            `${id}: the vendor's DPA date must live in an env var named <NAME>_DPA_SIGNED_ON`,
          );
      }
    }
    const days = SEVEN_DAY_SOURCES.has(id) ? 7 : 30;
    if (source.retentionDays !== days) problems.push(`${id}: retention must be ${days} days (D4)`);
    for (const host of source.allowedHosts)
      if (isPlatformWebHost(host)) problems.push(`${id}: ${host} is a platform's own site`);
    const finite = (n: number) => Number.isFinite(n) && n >= 0;
    if (!finite(source.costPerUnitUsd) || !finite(source.dailyBudget))
      problems.push(`${id}: cost and budget must be finite and not negative`);
  }
  return problems;
}
