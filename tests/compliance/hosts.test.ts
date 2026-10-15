import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDenylist } from "../../compliance/lib/denylist.mjs";
import { formatFindings, isTestFile, walk } from "../../compliance/lib/finding";
import { findNetworkPrimitives, findUnexpectedHosts } from "../../compliance/lib/scan-network";
import { OWN_HOSTS, PROCESSOR_HOSTS, STANDARDS_HOSTS } from "@/server/net/hosts";
import { SafeFetchError } from "@/server/net/safe-fetch";
import { safeFetch } from "@/server/net";
import { allowedHosts, declaredHosts, sources } from "@/sources/registry";

/**
 * CI gate `compliance:hosts` (docs/BRIEF.md, "CI gates").
 *   Static:  nothing in application code reaches the network except through safeFetch(), and
 *            every URL literal is on a known host.
 *   Runtime: the wired safeFetch() refuses every host that is not an enabled collect source.
 */

const deny = loadDenylist();
const SCAN_ROOTS = ["src", "emails", "supabase/functions"];
const files = SCAN_ROOTS.flatMap((root) => walk(root)).filter((f) =>
  /\.(ts|tsx|mts|js|mjs)$/.test(f),
);

describe("compliance:hosts (static)", () => {
  it("scans real files", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain("src/server/net/safe-fetch.ts");
  });

  it("no code reaches the network except through safeFetch()", () => {
    const findings = files.flatMap((file) =>
      findNetworkPrimitives(readFileSync(file, "utf8"), file, deny.networkModules),
    );
    expect(formatFindings(findings)).toBe("");
  });

  it("every URL literal is on a source, processor, own-domain or standards host", () => {
    const allowed = new Set<string>([
      ...declaredHosts(),
      ...PROCESSOR_HOSTS,
      ...OWN_HOSTS,
      ...STANDARDS_HOSTS,
    ]);
    const findings = files
      .filter((f) => !isTestFile(f))
      .flatMap((file) => findUnexpectedHosts(readFileSync(file, "utf8"), file, allowed));
    expect(formatFindings(findings)).toBe("");
  });
});

describe("compliance:hosts (runtime)", () => {
  afterEach(() => vi.restoreAllMocks());

  const refused = async (url: string) => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(safeFetch(url)).rejects.toBeInstanceOf(SafeFetchError);
    expect(spy).not.toHaveBeenCalled();
  };

  it("refuses hosts that were never on the allowlist", async () => {
    for (const url of [
      "https://example.org/",
      "https://evil.example/",
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/",
    ]) {
      await refused(url);
    }
  });

  it("refuses every host a link-only source declares: those are for the user's browser, never for us", async () => {
    expect(declaredHosts().length).toBeGreaterThan(0);
    for (const host of declaredHosts()) await refused(`https://${host}/`);
  });

  it("refuses lookalikes of every declared host", async () => {
    for (const host of declaredHosts()) {
      await refused(`https://${host}.evil.example/`);
      await refused(`https://evil.example/${host}`);
      await refused(`https://${host}@evil.example/`);
    }
  });

  it("refuses all hosts when no collect source is enabled", () => {
    expect(allowedHosts({})).toEqual([]);
  });

  it("never lets us fetch a platform's own site, whatever the env says", () => {
    // Route C (docs/PLAN.md, D1): Reddit content arrives through the contracted vendor's API host.
    // We never request reddit.com ourselves, and the other platforms are never collected at all.
    const everythingOn = Object.fromEntries(
      sources.map((s) => [`SOURCE_${s.id.toUpperCase()}_ENABLED`, "true"]),
    );
    const NEVER =
      /reddit|redd\.it|linkedin|facebook|instagram|tiktok|threads|youtube|discord|producthunt/i;
    // Web hosts of platforms we collect through an API: links point there, requests never do.
    const PLATFORM_WEB_HOSTS = new Set([
      "x.com",
      "www.x.com",
      "twitter.com",
      "www.twitter.com",
      "mobile.twitter.com",
      "bsky.app",
      "news.ycombinator.com",
      "indiehackers.com",
      "www.indiehackers.com",
    ]);
    const hosts = [...allowedHosts(everythingOn), ...sources.flatMap((s) => s.allowedHosts)];
    expect(hosts.filter((h) => NEVER.test(h) || PLATFORM_WEB_HOSTS.has(h))).toEqual([]);
  });
});
