import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDenylist } from "../../compliance/lib/denylist.mjs";
import { formatFindings, walk, type Finding } from "../../compliance/lib/finding";
import {
  findSourceHosts,
  findSourceImports,
  sourceModuleFiles,
} from "../../compliance/lib/scan-sources";
import { OWN_HOSTS, STANDARDS_HOSTS } from "@/server/net/hosts";
import { isPlatformHost } from "@/server/net/platform-hosts";
import { SafeFetchError } from "@/server/net/safe-fetch";
import { createSourceFetch } from "@/server/net/source-fetch";
import {
  allowedHosts,
  collectSources,
  isEnabled,
  isLaunchSource,
  killSwitchName,
  LAUNCH_COLLECT_SOURCES,
  registryProblems,
  sources,
} from "@/sources/registry";
import { VENDOR_DOMAINS } from "@/sources/reddit-vendor";
import type { CollectSource } from "@/sources/types";
import { checkSources } from "@/server/health/sources";

/**
 * Launch guards (the founder, 8 Nov 2026): a collect source never covers a platform that is never
 * collected, never imports a scraping or browser package, never names a host outside its own registry
 * entry, and a collect source that is not in the launch list stays off on every deployment, whatever
 * its switch says. Each rule is seen to fail on a planted violation.
 */

const collect = sources.filter((s): s is CollectSource => s.mode === "collect");
/** Every file under src/, subdirectories included, as the gate resolves imports against them. */
const files = walk("src");
const sourceFiles = files.filter((f) => f.startsWith("src/sources/"));
const read = (file: string) => readFileSync(file, "utf8");
const isTest = (file: string) => /\.test\.tsx?$/.test(file);

/**
 * A source's own hosts: its registry entry (API hosts, link hosts and the link hosts' bare domain,
 * terms page, and for the vendor source the vendor's own domains, which the module lists to refuse
 * them), plus our own and standards hosts.
 */
const ownHostsOf = (source: CollectSource): Set<string> =>
  new Set([
    ...source.allowedHosts,
    ...source.linkHosts,
    ...source.linkHosts.map((h) => h.split(".").slice(-2).join(".")),
    new URL(source.termsUrl).hostname,
    ...(source.vendor ? [new URL(source.vendor.dpaUrl).hostname, ...VENDOR_DOMAINS] : []),
    ...OWN_HOSTS,
    ...STANDARDS_HOSTS,
  ]);

function planted(over: Partial<CollectSource>): CollectSource {
  return {
    id: "planted",
    displayName: "Planted",
    mode: "collect",
    access: "official_api",
    termsUrl: "https://terms.example/planted",
    allowedHosts: ["api.planted.example"],
    linkHosts: [],
    dailyBudget: 10,
    retentionDays: 30,
    costPerUnitUsd: 0,
    credentials: [],
    start: async () => ({ kind: "done", posts: [], units: 0 }),
    ...over,
  };
}

describe("never-collected platforms", () => {
  it("the real registry has no collect source for them", () => {
    expect(registryProblems(sources)).toEqual([]);
  });

  it.each<[string, Partial<CollectSource>]>([
    ["by id", { id: "linkedin_posts" }],
    ["by display name", { displayName: "Instagram" }],
    ["by display name with spacing", { displayName: "Product Hunt" }],
    ["by an API host", { allowedHosts: ["api.linkedin.com"] }],
    ["by a CDN host", { allowedHosts: ["scontent.cdninstagram.com"] }],
    ["by a link host", { linkHosts: ["www.tiktok.com"] }],
    ["by its terms page", { termsUrl: "https://www.youtube.com/t/terms" }],
    ["Discord", { allowedHosts: ["discord.com"] }],
    ["Threads", { linkHosts: ["www.threads.com"] }],
    ["Facebook", { allowedHosts: ["graph.facebook.com"] }],
    ["Product Hunt by host", { allowedHosts: ["api.producthunt.com"] }],
    ["by a name it starts with", { displayName: "LinkedIn posts" }],
    ["by a wrapped host", { allowedHosts: ["www-linkedin-com.proxy.example"] }],
    ["by a host with the domain inside it", { allowedHosts: ["www.instagram.com.mirror.example"] }],
    ["by a messenger short link", { linkHosts: ["m.me"] }],
    ["by the TikTok API", { allowedHosts: ["open.tiktokapis.com"] }],
    [
      "by Google's API host, where the YouTube Data API lives",
      { allowedHosts: ["www.googleapis.com"] },
    ],
    ["by a short id", { id: "yt_comments" }],
    ["by a short id for Facebook", { id: "fb_groups" }],
    ["by a short id for Instagram", { id: "ig_posts" }],
    ["by a short id for Product Hunt", { id: "ph_launches" }],
  ])("a planted collect source %s is caught", (_, over) => {
    expect(registryProblems([planted(over)]).join("\n")).toMatch(/never collected/);
  });

  it("refuses a platform name anywhere in the display name, and Threads only as its first word", () => {
    expect(registryProblems([planted({ displayName: "Jobs from LinkedIn" })]).join()).toMatch(
      /never collected/,
    );
    expect(registryProblems([planted({ displayName: "Threads" })]).join()).toMatch(
      /never collected/,
    );
    expect(registryProblems([planted({ displayName: "Lobsters threads" })])).toEqual([]);
  });
});

describe("collect source modules", () => {
  it("each launch source has its module files, and the gate reads them", () => {
    for (const id of LAUNCH_COLLECT_SOURCES)
      expect(sourceModuleFiles(id, files).length).toBeGreaterThan(0);
    expect(sourceModuleFiles("reddit", files)).toContain("src/sources/reddit-brightdata.ts");
    expect(sourceModuleFiles("x", files)).toEqual(["src/sources/x.ts"]);
    // Helpers a source imports by a relative path are read too, transitively.
    expect(sourceModuleFiles("hackernews", files, read)).toContain("src/sources/text.ts");
    expect(sourceModuleFiles("x", files, read)).toContain("src/lib/html-entities.ts");
  });

  it("follows planted helpers through subdirectories and @/sources, and reports one it cannot read", () => {
    const root = mkdtempSync(path.join(tmpdir(), "sources-gate-"));
    try {
      const plant = (file: string, code: string) => {
        mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        writeFileSync(path.join(root, file), code);
      };
      plant(
        "src/sources/planted.ts",
        'import { a } from "./planted-free/helper";\nimport "./gone";',
      );
      plant("src/sources/planted-free/helper.ts", 'export { b } from "@/sources/deep/hosts";');
      plant("src/sources/deep/hosts.ts", 'export const u = "https://www.reddit.com/r/a.json";');
      const tree = walk("src", root);
      const problems: Finding[] = [];
      const found = sourceModuleFiles(
        "planted",
        tree,
        (f) => readFileSync(path.join(root, f), "utf8"),
        problems,
      );
      expect(found).toEqual([
        "src/sources/deep/hosts.ts",
        "src/sources/planted-free/helper.ts",
        "src/sources/planted.ts",
      ]);
      const hosts = found.flatMap((f) =>
        findSourceHosts(readFileSync(path.join(root, f), "utf8"), f, new Set(["api.p.example"])),
      );
      expect(formatFindings(hosts)).toMatch(/www\.reddit\.com/);
      expect(formatFindings(problems)).toMatch(/"\.\/gone" resolves to no file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("no file under src/sources imports a scraping, browser or other outside package", () => {
    const denylist = loadDenylist();
    const findings = sourceFiles
      .filter((f) => /\.tsx?$/.test(f) && !isTest(f))
      .flatMap((file) => findSourceImports(read(file), file, denylist));
    expect(formatFindings(findings)).toBe("");
  });

  it.each([
    ['import puppeteer from "puppeteer";', /puppeteer.*denylist/],
    ['import { chromium } from "playwright";', /playwright/],
    ['import { test } from "@playwright/test";', /playwright/],
    ['export { launch } from "puppeteer-core";', /puppeteer-core/],
    ['const c = await import("crawlee");', /crawlee/],
    ['const b = require("@brightdata/sdk");', /@brightdata/],
    ['import got from "got";', /got/],
    ["const m = await import(name);", /dynamic import/],
  ])("a planted import is caught: %s", (code, rule) => {
    const findings = findSourceImports(code, "src/sources/planted.ts", loadDenylist());
    expect(formatFindings(findings)).toMatch(rule);
  });

  it("collect source modules import nothing from @/server/, where the fetch builders live", () => {
    const denylist = loadDenylist();
    const findings = collect.flatMap((s) =>
      sourceModuleFiles(s.id, files, read).flatMap((file) =>
        findSourceImports(read(file), file, denylist, { strict: true }),
      ),
    );
    expect(formatFindings(findings)).toBe("");
  });

  it.each([
    'import { createSafeFetch } from "@/server/net/safe-fetch";',
    'import { createSourceFetch } from "@/server/net/source-fetch";',
    'import { fetchOwnSite } from "@/server/net/own-site";',
  ])("a planted @/server import in a source module is caught: %s", (code) => {
    const findings = findSourceImports(code, "src/sources/planted.ts", loadDenylist(), {
      strict: true,
    });
    expect(formatFindings(findings)).toMatch(/may import only @\/lib\/ and @\/sources\//);
  });

  it("allows the source's own imports: relative, @/ and zod", () => {
    const code = [
      'import { z } from "zod";',
      'import "server-only";',
      'import { toExcerpt } from "./text";',
      'import { createSourceFetch } from "@/server/net/source-fetch";',
      'import type { Source } from "../sources/types";',
    ].join("\n");
    expect(findSourceImports(code, "src/sources/planted.ts", loadDenylist())).toEqual([]);
  });

  it("name no host outside their own registry entry, and every import they follow is readable", () => {
    const problems: Finding[] = [];
    const findings = collect.flatMap((s) =>
      sourceModuleFiles(s.id, files, read, problems).flatMap((file) =>
        findSourceHosts(read(file), file, ownHostsOf(s), isPlatformHost),
      ),
    );
    expect(formatFindings([...problems, ...findings])).toBe("");
  });

  it.each([
    ['const u = "https://www.reddit.com/search.json?q=a";', /www\.reddit\.com/],
    ["const u = `https://api.x.com/2/tweets/search/recent?q=${q}`;", /api\.x\.com/],
    ['const HOST = "hn.algolia.com";', /hn\.algolia\.com/],
    ['const u = new URL("/v1", "https://api.other.example");', /api\.other\.example/],
    ['const PROXY = "translate.goog";', /translate\.goog/],
    ['const MIRROR = "piped.video";', /piped\.video/],
  ])("a planted host in the Bluesky module is caught: %s", (code, host) => {
    const own = ownHostsOf(collect.find((s) => s.id === "bluesky")!);
    const findings = findSourceHosts(code, "src/sources/bluesky.ts", own, isPlatformHost);
    expect(formatFindings(findings)).toMatch(host);
  });

  it("refuses at run time every host but the source's own, through its ctx.fetch", async () => {
    const env = Object.fromEntries(collect.map((s) => [killSwitchName(s), "true"]));
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response("{}");
    }) as typeof fetch;
    const launch = collect.filter(isLaunchSource);
    for (const source of launch) {
      const sourceFetch = createSourceFetch(source, { env, fetchImpl });
      // Positive control: its own host is reached.
      await expect(sourceFetch(`https://${source.allowedHosts[0]}/`)).resolves.toBeInstanceOf(
        Response,
      );
      for (const other of collect.filter((o) => o.id !== source.id))
        for (const host of other.allowedHosts) {
          const refused = await sourceFetch(`https://${host}/`).catch((error: unknown) => error);
          expect(refused, `${source.id} -> ${host}`).toBeInstanceOf(SafeFetchError);
          expect((refused as SafeFetchError).code).toBe("host_not_allowed");
        }
    }
    expect(calls).toBe(launch.length);
  });
});

describe("launch sources on deployments", () => {
  const allOn = Object.fromEntries(collect.map((s) => [killSwitchName(s), "true"]));
  const production = { ...allOn, VERCEL_ENV: "production", BRIGHTDATA_DPA_SIGNED_ON: "2026-11-01" };

  it("the launch list is Hacker News, Bluesky and Reddit, and X is not in it", () => {
    expect([...LAUNCH_COLLECT_SOURCES].sort()).toEqual(["bluesky", "hackernews", "reddit"]);
    expect(isLaunchSource({ id: "x", mode: "collect" })).toBe(false);
    expect(isLaunchSource({ id: "x_links", mode: "link" })).toBe(true);
  });

  it.each(["production", "preview"])("X stays off on a %s deployment with its switch on", (env) => {
    const e = { ...production, VERCEL_ENV: env };
    const x = collect.find((s) => s.id === "x")!;
    expect(isEnabled(x, e)).toBe(false);
    expect(collectSources(e).map((s) => s.id)).not.toContain("x");
    expect(allowedHosts(e)).not.toContain("api.x.com");
  });

  it("a planted non-launch source is off in production, and the health check says why", () => {
    const fake = planted({ id: "x" });
    expect(isEnabled(fake, production)).toBe(false);
    expect(isEnabled(fake, { ...production, VERCEL_ENV: undefined, NODE_ENV: "production" })).toBe(
      false,
    );
    const health = checkSources(production, new Date("2026-11-08T12:00:00Z"));
    expect(health.status).toBe("invalid");
    expect(health.detail).toMatch(/x held: not in launch/);
  });

  it("launch sources still switch on in production, and a local run is not held back", () => {
    const hn = collect.find((s) => s.id === "hackernews")!;
    const x = collect.find((s) => s.id === "x")!;
    expect(isEnabled(hn, production)).toBe(true);
    expect(isEnabled(x, { SOURCE_X_ENABLED: "true", NODE_ENV: "test" })).toBe(true);
  });
});
