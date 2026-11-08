import { isHostAllowed } from "@/server/net/safe-fetch";
import {
  isPlatformWebHost,
  matchesDomain,
  matchesOrWraps,
  NEVER_COLLECTED_DOMAINS,
} from "@/server/net/platform-hosts";
import { bluesky } from "./bluesky";
import { hackernews } from "./hackernews";
import { facebook, indiehackers, linkedin, redditLinks, threads, xLinks } from "./link-sources";
import { reddit } from "./reddit";
import { VENDOR_DOMAINS } from "./reddit-vendor";
import type { CollectSource, LinkSource, Source } from "./types";
import { x } from "./x";

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

/**
 * The collect sources in Launch 1 (the founder, 8 Nov 2026): Hacker News, Bluesky and Reddit, Reddit
 * once 2.1.7 holds. X is out of launch: its code stays, switched off, and the public pages say it is
 * coming later. Adding X here is the founder's decision after launch (F18).
 */
export const LAUNCH_COLLECT_SOURCES = ["hackernews", "bluesky", "reddit"] as const;

export const isLaunchSource = (source: Pick<Source, "id" | "mode">): boolean =>
  source.mode === "link" || (LAUNCH_COLLECT_SOURCES as readonly string[]).includes(source.id);

type Env = Readonly<Record<string, string | undefined>>;

export function killSwitchName(source: Pick<Source, "id">): string {
  return `SOURCE_${source.id.toUpperCase()}_ENABLED`;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day as YYYY-MM-DD (2026-02-30 and 2026-13-01 are not). */
function isIsoDay(value: string | undefined): value is string {
  if (!value || !ISO_DAY.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/**
 * docs/PLAN.md 2.1.7: on a deployment (anything but a local run), a vendor source stays off until the
 * env var its vendor names holds the date the DPA, transfer mechanism and DPIA were done, and until
 * the module states how long the vendor keeps snapshots (2.3.12), which the notice then shows. Local
 * runs (development, and the founder's capture script) are not held back.
 */
export function vendorClearance(
  source: Source,
  env: Env = process.env,
  now: Date = new Date(),
): "not_vendor" | "cleared" | "dpa_missing" | "notice_missing" {
  if (source.mode !== "collect" || source.access !== "vendor_api") return "not_vendor";
  if (isLocalRun(env)) return "cleared";
  if (!dpaSignedOn(source, env, now)) return "dpa_missing";
  return snapshotRetention(source) ? "cleared" : "notice_missing";
}

/**
 * How long the vendor keeps the snapshots it delivers, as the privacy notice states it (docs/PLAN.md
 * 2.3.12): set in the module, in the commit that records the vendor's written answer (with
 * docs/legal/processors.md and a docs/claims.md row). Null until then, which keeps the source off
 * on deployments.
 */
export function snapshotRetention(source: Source): string | null {
  if (source.mode !== "collect" || !source.vendor) return null;
  return source.vendor.snapshotRetention;
}

/**
 * Only a run that says it is local skips the DPA gate: Vercel's development env, or no Vercel env
 * at all outside a production build. Anything else (a production server off Vercel, an unknown
 * VERCEL_ENV) is held back like a deployment.
 */
function isLocalRun(env: Env): boolean {
  if (env.VERCEL_ENV !== undefined) return env.VERCEL_ENV === "development";
  return env.NODE_ENV !== "production";
}

/**
 * The vendor's DPA date when it is a valid day no later than today (UTC), for the gate and the
 * notice; null otherwise, so a date set ahead of signing clears nothing.
 */
export function dpaSignedOn(
  source: Source,
  env: Env = process.env,
  now: Date = new Date(),
): string | null {
  if (source.mode !== "collect" || !source.vendor) return null;
  const value = env[source.vendor.dpaSignedOnEnv];
  return isIsoDay(value) && value <= now.toISOString().slice(0, 10) ? value : null;
}

/**
 * Kill switch. Collect sources are off unless SOURCE_<ID>_ENABLED is exactly "true" (and, for a
 * vendor source on a deployment, it is cleared by vendorClearance). Link sources are on unless it is exactly
 * "false". A source can be paused in minutes by changing an env var if its terms change.
 */
export function isEnabled(source: Source, env: Env = process.env): boolean {
  const value = env[killSwitchName(source)];
  if (source.mode === "link") return value !== "false";
  if (heldOutOfLaunch(source, env)) return false;
  const clearance = vendorClearance(source, env);
  return value === "true" && (clearance === "cleared" || clearance === "not_vendor");
}

/**
 * A collect source outside LAUNCH_COLLECT_SOURCES stays off on every deployment, whatever its
 * switch says (the founder, 8 Nov 2026): X is out of launch. Local runs are not held back, so its
 * tests still run.
 */
export function heldOutOfLaunch(source: Source, env: Env = process.env): boolean {
  return !isLaunchSource(source) && !isLocalRun(env);
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

/** Short forms of never-collected platforms, as an id part: fb_groups, ig_posts, yt_comments. */
const NEVER_COLLECTED_SHORT_IDS = new Set(["fb", "ig", "yt", "tt", "ph", "li"]);

/**
 * API domains a collect source never calls although a user's site may live there: the YouTube Data
 * API is on www.googleapis.com, so googleapis.com is refused for collect sources only, not by
 * fetchOwnSite (a product site on storage.googleapis.com is still readable).
 */
const COLLECT_REFUSED_API_DOMAINS = ["googleapis.com"];

const hostOf = (raw: string) => {
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
};

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
    // By the platform name inside the id or the display name too: "linkedin_jobs" is LinkedIn,
    // and so is a source called "LinkedIn posts"; and by every host it names.
    // The display name by whole words anywhere ("Jobs from LinkedIn"), two words joined for
    // "Product Hunt" and "Indie Hackers"; "threads" is an ordinary word, so only as the first.
    const words = source.displayName
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const named = new Set([...words, ...words.slice(1).map((w, i) => `${words[i]}${w}`)]);
    named.delete("threads");
    if (words[0] === "threads") named.add("threads");
    if (
      NEVER_COLLECTED.some(
        (platform) => id.replaceAll("_", "").includes(platform) || named.has(platform),
      ) ||
      id.split("_").some((part) => NEVER_COLLECTED_SHORT_IDS.has(part))
    )
      problems.push(`${id} is never collected (docs/PLAN.md 2.1)`);
    const hosts = [
      ...source.allowedHosts,
      ...source.linkHosts,
      hostOf(source.termsUrl),
      ...(source.vendor ? [hostOf(source.vendor.dpaUrl)] : []),
    ];
    for (const host of hosts)
      if (
        matchesOrWraps(host, NEVER_COLLECTED_DOMAINS) ||
        matchesDomain(host, COLLECT_REFUSED_API_DOMAINS)
      )
        problems.push(
          `${id}: ${host} belongs to a platform that is never collected (docs/PLAN.md 2.1)`,
        );
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
    // A source may read only its own env names: "<ID>_..." or "<VENDOR>_..." (2.1.9).
    const prefixes = [id, ...(source.vendor ? [source.vendor.name] : [])].map(
      (name) => `${name.toUpperCase().replace(/[^A-Z0-9]/g, "")}_`,
    );
    for (const name of source.credentials)
      if (!/^[A-Z][A-Z0-9_]*$/.test(name) || !prefixes.some((p) => name.startsWith(p)))
        problems.push(`${id}: credential ${name} is not its own`);
    for (const name of source.requiredCredentials ?? [])
      if (!source.credentials.includes(name))
        problems.push(`${id}: required credential ${name} is not in its credentials`);
    const finite = (n: number) => Number.isFinite(n) && n >= 0;
    if (!finite(source.costPerUnitUsd) || !finite(source.dailyBudget))
      problems.push(`${id}: cost and budget must be finite and not negative`);
  }
  return problems;
}
