import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installTargets, isBlockedPackage, loadDenylist, packageName } from "./denylist.mjs";
import {
  claimNumbers,
  checkCopy,
  copyGateFiles,
  copyScanRoots,
  copyScopeOf,
  extractCopy,
  findLogoFiles,
  runCopyGate,
  scanCopyFile,
  unscopedUiFiles,
} from "./scan-copy";
import { findBlockedPackages, lockfileName } from "./scan-deps";
import {
  FETCH_WRAPPER_FILE,
  findNetworkPrimitives,
  findRemoteFonts,
  findUnexpectedHosts,
  moduleName,
} from "./scan-network";
import { findSchemaViolations, parseAddedColumns, parseCreateTables } from "./scan-schema";

/**
 * A gate that has never been seen to fail is not a gate. Each test here plants a violation the
 * hard compliance rules forbid and checks the scanner reports it, and plants a lookalike that
 * is fine and checks the scanner stays quiet.
 */

const deny = loadDenylist();
const rules = (findings: { rule: string }[]) => findings.map((f) => f.rule);

describe("network scanner", () => {
  const scan = (code: string, file = "src/x.ts") =>
    findNetworkPrimitives(code, file, deny.networkModules);

  describe("fetchOwnSite exception (docs/PLAN.md 12.3)", () => {
    it("lets src/server/net/own-site.ts import node:https and node:dns, and nothing else", () => {
      const ownSite = "src/server/net/own-site.ts";
      expect(scan(`import https from "node:https"; import dns from "node:dns";`, ownSite)).toEqual(
        [],
      );
      expect(
        scan(`import { lookup } from "dns"; import { request } from "https";`, ownSite),
      ).toEqual([]);
      for (const mod of ["node:http", "node:net", "node:tls", "undici", "node:child_process"])
        expect(rules(scan(`import x from "${mod}"`, ownSite)), mod).toContain(
          "banned-network-module",
        );
      expect(rules(scan(`await fetch("https://x.example")`, ownSite))).toContain("global-fetch");
    });

    it.each([
      ["src/sources/hackernews.ts", `import { fetchOwnSite } from "@/server/net/own-site";`],
      ["src/server/net/index.ts", `export * from "./own-site";`],
      ["src/server/pipeline/collect.ts", `const m = await import("@/server/net/own-site");`],
      [
        "src/app/api/x/route.ts",
        `import { createFetchOwnSite } from "../../../server/net/own-site";`,
      ],
    ])("refuses fetchOwnSite outside onboarding and the preview: %s", (file, code) => {
      expect(rules(scan(code, file))).toContain("own-site-import");
    });

    it.each([
      "src/server/onboarding/deps.ts",
      "src/server/preview/run.ts",
      "src/server/net/own-site.test.ts",
    ])("lets %s use fetchOwnSite", (file) => {
      expect(scan(`import { fetchOwnSite } from "@/server/net/own-site";`, file)).toEqual([]);
    });

    it.each([
      ["a re-export", `export { request } from "node:https";`],
      ["a re-export of everything", `export * from "node:dns";`],
      ["require()", `const https = require("node:https");`],
      ["a dynamic import", `const dns = await import("node:dns");`],
      ["an import passed on by name", `import https from "node:https"; export { https };`],
      ["an import passed on renamed", `import * as h from "node:https"; export { h as net };`],
      ["an import as the default export", `import dns from "node:dns"; export default dns;`],
    ])("allows only static imports there, so it cannot hand node:https on: %s", (_label, code) => {
      expect(rules(scan(code, "src/server/net/own-site.ts"))).toContain("banned-network-module");
    });

    it.each([
      "src/server/net/own-site-helper.ts",
      "src/server/net/safe-fetch.ts",
      "src/server/onboarding/draft.ts",
      "src/sources/hackernews.ts",
    ])("still fails node:https or node:dns imported in %s", (file) => {
      expect(rules(scan(`import https from "node:https"`, file))).toContain(
        "banned-network-module",
      );
      expect(rules(scan(`import dns from "node:dns"`, file))).toContain("banned-network-module");
    });
  });

  it.each([
    ["a direct call", `await fetch("https://evil.example")`],
    ["an alias", `const f = fetch; f("https://evil.example")`],
    ["globalThis", `globalThis.fetch("https://evil.example")`],
    ["window", `window.fetch("https://evil.example")`],
    ["a default argument", `function go(impl = fetch) { return impl }`],
    ["a shorthand property", `const deps = { fetch }`],
  ])("flags the global fetch via %s", (_label, code) => {
    expect(rules(scan(code))).toContain("global-fetch");
  });

  it.each([
    ["axios", `import axios from "axios"`],
    ["node:https", `import https from "node:https"`],
    ["http", `import { request } from "http"`],
    ["got deep import", `import got from "got/dist/source"`],
    ["a re-export", `export { default } from "undici"`],
    ["require", `const g = require("got")`],
    ["dynamic import", `const u = await import("undici")`],
    ["child_process (curl)", `import { exec } from "node:child_process"`],
    ["import equals", `import n = require("node-fetch")`],
  ])("flags a banned module: %s", (_label, code) => {
    expect(rules(scan(code))).toContain("banned-network-module");
  });

  it.each(["WebSocket", "XMLHttpRequest", "EventSource"])("flags new %s()", (ctor) => {
    expect(rules(scan(`const s = new ${ctor}("wss://x.example")`))).toContain("raw-network-api");
  });

  it("stays quiet about lookalikes", () => {
    const quiet = scan(`
      // fetch("https://commented.example") is only a comment
      const text = "call fetch( to go online";
      const safe = await safeFetch("https://x.example");
      const props = { fetch: handler, fetchImpl: other };
      client.fetch(thing);
      function run(opts: { fetch?: unknown }) { return opts.fetch }
      type F = typeof globalThis.fetch;
      import { z } from "zod";
    `);
    expect(quiet).toEqual([]);
  });

  it("lets the wrapper, and only the wrapper, reference the global fetch", () => {
    const code = `export const f = opts.fetchImpl ?? globalThis.fetch;`;
    expect(scan(code, FETCH_WRAPPER_FILE)).toEqual([]);
    expect(rules(scan(code, "src/other.ts"))).toContain("global-fetch");
  });

  it("reports the line number", () => {
    expect(scan(`const a = 1;\n\nawait fetch(x);`)[0]?.line).toBe(3);
  });

  it("normalises module specifiers", () => {
    expect(moduleName("node:https")).toBe("https");
    expect(moduleName("got/dist/x")).toBe("got");
    expect(moduleName("@scope/pkg/deep")).toBe("@scope/pkg");
  });
});

describe("URL host scanner", () => {
  const allowed = new Set(["api.example.test", "askedfor.app"]);

  it("flags a URL literal on an unexpected host, and passes allowed ones", () => {
    const findings = findUnexpectedHosts(
      `const a = "https://api.example.test/v1"; const b = "https://tracker.evil.example/pixel.gif";`,
      "src/x.ts",
      allowed,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: "unexpected-host" });
    expect(findings[0]?.detail).toContain("tracker.evil.example");
  });

  it("flags hosts inside template literals and JSX", () => {
    expect(
      findUnexpectedHosts("const u = `https://cdn.evil.example/${path}`", "src/x.ts", allowed),
    ).toHaveLength(1);
    expect(
      findUnexpectedHosts(
        `export const P = () => <a href="https://evil.example/x">x</a>;`,
        "src/p.tsx",
        allowed,
      ),
    ).toHaveLength(1);
  });

  it("flags a URL whose host is built at runtime", () => {
    expect(
      rules(findUnexpectedHosts("const u = `https://${host}/path`", "src/x.ts", allowed)),
    ).toEqual(["dynamic-url-host"]);
  });

  it("does not flag a template that only appends a path to a configured base", () => {
    expect(findUnexpectedHosts("const u = `${base}/settings?x=1`", "src/x.ts", allowed)).toEqual(
      [],
    );
  });

  it("ignores comments and import specifiers", () => {
    expect(
      findUnexpectedHosts(
        `// see https://docs.evil.example\nimport x from "https://esm.sh/x";`,
        "src/x.ts",
        allowed,
      ),
    ).toEqual([]);
  });

  it("is case-insensitive about hosts", () => {
    expect(
      findUnexpectedHosts(`const a = "https://API.Example.TEST/x"`, "src/x.ts", allowed),
    ).toEqual([]);
  });
});

describe("dependency scanner", () => {
  const pkg = { dependencies: { next: "16.0.0" }, devDependencies: { vitest: "5.0.0" } };
  const lock = (names: string[], dev: Record<string, boolean> = {}) => ({
    packages: Object.fromEntries([
      ["", {}],
      ...names.map((n) => [`node_modules/${n}`, { dev: dev[n] }]),
    ]),
  });

  it("passes a clean tree", () => {
    expect(findBlockedPackages(lock(["next", "react"]), pkg, deny)).toEqual([]);
  });

  it.each([
    "puppeteer",
    "apify-client",
    "@apify/consts",
    "serpapi",
    "snoowrap",
    "playwright-extra",
    "@brightdata/sdk",
  ])("flags %s anywhere in the lockfile, including nested and transitive", (name) => {
    const key = `some-lib/node_modules/${name}`;
    const findings = findBlockedPackages({ packages: { [`node_modules/${key}`]: {} } }, pkg, deny);
    expect(rules(findings)).toContain("blocked-package");
  });

  it("flags a blocked direct dependency in package.json", () => {
    const findings = findBlockedPackages(lock([]), { dependencies: { crawlee: "3.0.0" } }, deny);
    expect(findings[0]).toMatchObject({ file: "package.json", rule: "blocked-package" });
  });

  it("allows Playwright as a dev dependency but not in production", () => {
    expect(
      findBlockedPackages(
        lock(["@playwright/test"], { "@playwright/test": true }),
        { devDependencies: { "@playwright/test": "1" } },
        deny,
      ),
    ).toEqual([]);
    expect(
      rules(findBlockedPackages(lock([]), { dependencies: { "@playwright/test": "1" } }, deny)),
    ).toContain("dev-only-package");
    expect(
      rules(findBlockedPackages(lock(["playwright"], { playwright: false }), pkg, deny)),
    ).toContain("dev-only-package");
  });

  it("reads the lockfile the way npm writes it: no dev key means production", () => {
    const asNpmWrites = (entry: Record<string, boolean>) => ({
      packages: { "": {}, "node_modules/playwright": entry },
    });
    expect(rules(findBlockedPackages(asNpmWrites({}), pkg, deny))).toContain("dev-only-package");
    // An optional peer of a production package that only a devDependency installs.
    expect(findBlockedPackages(asNpmWrites({ devOptional: true }), pkg, deny)).toEqual([]);
    expect(findBlockedPackages(asNpmWrites({ dev: true }), pkg, deny)).toEqual([]);
  });

  it("reads package names from lockfile keys", () => {
    expect(lockfileName("node_modules/a/node_modules/@b/c")).toBe("@b/c");
    expect(lockfileName("")).toBeNull();
  });
});

describe("install hook helpers", () => {
  it("normalises specifiers", () => {
    expect(packageName("foo@1.2.3")).toBe("foo");
    expect(packageName("@scope/foo@latest")).toBe("@scope/foo");
    expect(packageName("npm:puppeteer@22")).toBe("puppeteer");
    expect(packageName("Scrapy_Splash>=1.0")).toBe("scrapy-splash");
    expect(packageName("selenium[extras]==4")).toBe("selenium");
    expect(packageName("./local")).toBeNull();
    expect(packageName("https://x.test/pkg.tgz")).toBeNull();
  });

  it.each([
    ["npm install puppeteer", ["puppeteer"]],
    ["npm i -D @playwright/test", ["@playwright/test"]],
    ["pnpm add apify-client@3 zod", ["apify-client@3", "zod"]],
    ["yarn add crawlee", ["crawlee"]],
    ["npx puppeteer-extra-plugin-stealth --help", ["puppeteer-extra-plugin-stealth"]],
    ["pip install selenium requests", ["selenium", "requests"]],
    ["pip install -r requirements.txt", []],
    ["cd app && npm install serpapi && npm test", ["serpapi"]],
    ["npm run build", []],
    ["npm install", []],
    ["bun add snoowrap; echo done", ["snoowrap"]],
  ])("%s", (command, expected) => {
    expect(installTargets(command)).toEqual(expected);
  });

  it("blocks scraping packages, scopes and versions, and allows ordinary ones", () => {
    expect(isBlockedPackage("puppeteer@22.1.0", deny)).toBe(true);
    expect(isBlockedPackage("@apify/anything", deny)).toBe(true);
    expect(isBlockedPackage("zod", deny)).toBe(false);
    expect(isBlockedPackage("cheerio", deny)).toBe(false);
    expect(isBlockedPackage("@playwright/test", deny)).toBe(false);
  });
});

describe("schema scanner", () => {
  const scan = (sql: string) => findSchemaViolations({ "m.sql": sql }, deny);
  const withRls = (sql: string, table: string) =>
    `${sql}\nalter table public.${table} enable row level security;`;

  it.each([
    "avatar_url",
    "bio",
    "follower_count",
    "author_email",
    "profile_image",
    "followers",
    "phone",
  ])("flags %s on the posts table", (column) => {
    const sql = withRls(
      `create table public.posts (id uuid primary key, ${column} text);`,
      "posts",
    );
    expect(rules(scan(sql))).toContain("post-table-pii-column");
  });

  it("flags a column added to a post table later", () => {
    const sql = `${withRls("create table public.product_posts (id uuid);", "product_posts")}\nalter table public.product_posts add column avatar text;`;
    expect(rules(scan(sql))).toContain("post-table-pii-column");
  });

  it("flags a quoted or renamed column", () => {
    const sql = `${withRls("create table public.posts (id uuid, other text);", "posts")}\nalter table public.posts rename column other to "Bio";`;
    expect(rules(scan(sql))).toContain("post-table-pii-column");
  });

  it("allows those columns on other tables, and ignores comments that mention them", () => {
    const sql = withRls(
      `-- posts never get an avatar, bio, follower or email column
       create table public.removal_requests (id uuid, contact_email text);
       /* avatar */`,
      "removal_requests",
    );
    expect(scan(sql)).toEqual([]);
  });

  it("does not mistake constraints for columns", () => {
    const [t] = parseCreateTables(
      `create table public.t (id uuid, constraint c check (a > 1 and b > 2), unique (a, b), primary key (id));`,
    );
    expect(t?.columns).toEqual(["id"]);
  });

  it("flags a table that never enables row level security", () => {
    expect(rules(scan("create table public.leaky (id uuid);"))).toEqual(["rls-missing"]);
    expect(scan(withRls("create table public.ok (id uuid);", "ok"))).toEqual([]);
  });

  it("flags any grant to anon, but not a revoke", () => {
    expect(rules(scan("grant select on public.posts to anon;"))).toContain("grant-to-anon");
    expect(
      rules(
        scan(
          "alter default privileges in schema public grant all on tables to anon, authenticated;",
        ),
      ),
    ).toContain("grant-to-anon");
    expect(scan("revoke all on all tables in schema public from anon;")).toEqual([]);
    expect(scan("grant select on public.posts to authenticated;")).toEqual([]);
  });

  it("parses added columns", () => {
    expect(
      parseAddedColumns(
        "alter table public.x add column a int, add column if not exists b text;",
      )[0]?.columns,
    ).toEqual(["a", "b"]);
  });
});

describe("copy scanner", () => {
  const scan = (code: string, numbers: string[] = []) =>
    checkCopy(extractCopy(code, "page.tsx"), "page.tsx", deny, new Set(numbers));

  it("extracts words a reader sees and skips plumbing", () => {
    const text = extractCopy(
      `import x from "./x";
       export const metadata = { title: "Who to reply to", path: "/pricing" };
       export default function P() {
         return <a className="mt-4 text-3xl" href="/pricing" aria-label="Pricing page">Plans and pricing</a>;
       }`,
      "page.tsx",
    ).map((i) => i.text);
    expect(text).toEqual(
      expect.arrayContaining(["Who to reply to", "Pricing page", "Plans and pricing"]),
    );
    expect(text.join("|")).not.toMatch(/mt-4|\/pricing|\.\/x/);
  });

  it("flags an em dash", () => {
    expect(rules(scan(`export const A = () => <p>Fast \u2014 simple</p>;`))).toContain("em-dash");
  });

  it.each([
    "revolutionary",
    "Revolutionary",
    "seamlessly",
    "unlocks",
    "guaranteed results",
    "10x faster",
    "game-changing",
  ])("flags the hype word in %s", (phrase) => {
    expect(rules(scan(`export const A = () => <p>A ${phrase} tool</p>;`))).toContain(
      "banned-phrase",
    );
  });

  it.each([
    "We never scrape anything",
    "No scraping, ever",
    "Built without scraping",
    "We don't scrape Reddit",
    "We don\u2019t scrape Reddit",
    "We do not scrape",
    "Official APIs only",
    "We only use official APIs",
    "Official API only",
    "AskedFor is not a scraper",
    "We dont scrape",
    // JSX must escape apostrophes (react/no-unescaped-entities), so real pages write entities.
    "We don&apos;t scrape Reddit",
    "We don&rsquo;t scrape Reddit",
    "We don&#39;t scrape Reddit",
    "We don&#x27;t scrape Reddit",
    "AskedFor doesn&apos;t scrape",
    "AskedFor does not scrape",
    "A scraping-free lead feed",
    "Scrape-free by design",
  ])("flags a claim that hides the data provider (docs/PLAN.md, D12): %s", (phrase) => {
    expect(rules(scan(`export const A = () => <p>${phrase}</p>;`))).toContain("banned-phrase");
  });

  it("flags an em dash written as an HTML entity", () => {
    for (const dash of ["&mdash;", "&#8212;", "&#x2014;"])
      expect(rules(scan(`export const A = () => <p>Fast${dash}simple</p>;`)), dash).toContain(
        "em-dash",
      );
  });

  it("flags competitor names", () => {
    expect(rules(scan(`export const A = () => <p>Better than Ownfeed</p>;`))).toContain(
      "competitor-name",
    );
  });

  it.each(["colour", "organisation", "labelled", "cancelled", "Cancelling"])(
    "flags the UK spelling %s",
    (word) => {
      expect(rules(scan(`export const A = () => <p>Your ${word} here</p>;`))).toContain(
        "uk-spelling",
      );
    },
  );

  it("accepts the US spellings", () => {
    expect(scan(`export const A = () => <p>Canceling a canceled color organization</p>;`)).toEqual(
      [],
    );
  });

  it("flags numbers that are not in the claims register, and accepts those that are", () => {
    const code = `export const A = () => <p>Delete posts after 30 days. 99 percent of makers agree.</p>;`;
    const findings = scan(code, ["30"]);
    expect(findings.map((f) => f.detail)).toEqual([expect.stringContaining('"99"')]);
  });

  it("reads numbers only from the exact-claim column of the register", () => {
    const md = [
      "Rules: ship within 24 hours of version 2.",
      "| ID | Exact claim | Evidence |",
      "| --- | --- | --- |",
      "| retention | Raw posts are deleted after 30 days | policy 77 |",
    ].join("\n");
    expect(claimNumbers(md)).toEqual(new Set(["30"]));
  });

  it("does not let a number in the rules prose approve that number in copy", () => {
    const numbers = claimNumbers(
      "Never promise results in 24 hours.\n| ID | Exact claim |\n| --- | --- |\n",
    );
    expect(
      rules(scan(`export const A = () => <p>Results in 24 hours</p>;`, [...numbers])),
    ).toContain("unsourced-number");
  });

  it("does not read markup or entities as numbers", () => {
    expect(scan('export const t = `<h1>Hi</h1><p style="x">it&#39;s fine</p>`;')).toEqual([]);
  });

  it("flags a hype word inside a template literal", () => {
    expect(rules(scan("export const t = `A ${x} revolutionary tool`;"))).toContain("banned-phrase");
  });
});

describe("copy scanner on app UI (docs/PLAN.md 3.2)", () => {
  const appFile = "src/app/(app)/app/reply/page.tsx";
  const scanFile = (file: string, code: string, numbers: string[] = []) =>
    scanCopyFile(file, code, deny, new Set(numbers));

  it("knows which files are public copy, which are app UI, and which are neither", () => {
    expect(copyScopeOf("src/app/(marketing)/pricing/page.tsx", deny)).toBe("public");
    expect(copyScopeOf("src/app/layout.tsx", deny)).toBe("public");
    expect(copyScopeOf("emails/daily.ts", deny)).toBe("public");
    expect(copyScopeOf(appFile, deny)).toBe("app");
    expect(copyScopeOf("src/app/(admin)/admin/page.tsx", deny)).toBe("app");
    expect(copyScopeOf("src/components/ui/button.tsx", deny)).toBe("app");
    expect(copyScopeOf("src/server/net/hosts.ts", deny)).toBeNull();
    // A lookalike folder name is not a scan root; Windows separators do not escape one.
    expect(copyScopeOf("src/components-old/x.tsx", deny)).toBeNull();
    expect(copyScopeOf("src\\components\\ui\\x.tsx", deny)).toBe("app");
    expect(copyScopeOf("./src/components/ui/x.tsx", deny)).toBe("app");
  });

  it("catches every planted violation in an app file, each on its own line", () => {
    const code = [
      "export default function Reply() {",
      "  return (",
      "    <section>",
      "      <h1>Today \u2014 your posts</h1>",
      "      <p>A revolutionary feed</p>",
      "      <p>Better than GummySearch</p>",
      "      <p>Your favourite posts</p>",
      '      <button aria-label="Unlock more">More</button>',
      "      <p>We don&apos;t scrape anything</p>",
      "      <p>Posts organised by colour</p>",
      "    </section>",
      "  );",
      "}",
    ].join("\n");
    const found = scanFile(appFile, code).map((f) => `${f.line}:${f.rule}`);
    expect(found.sort()).toEqual(
      [
        "4:em-dash",
        "5:banned-phrase",
        "6:competitor-name",
        "7:uk-spelling",
        "8:banned-phrase",
        "9:banned-phrase",
        "10:uk-spelling",
        "10:uk-spelling",
      ].sort(),
    );
  });

  it("does not flag a number in app copy, which comes from live data, not a claim", () => {
    const code = `export const Count = () => <p>42 new posts today, 3 saved, match 87</p>;`;
    expect(scanFile(appFile, code)).toEqual([]);
    expect(scanFile("src/components/app/post-card.tsx", code)).toEqual([]);
  });

  it("still flags the same number on a public page", () => {
    const code = `export const Count = () => <p>42 new posts today</p>;`;
    expect(rules(scanFile("src/app/(marketing)/page.tsx", code))).toContain("unsourced-number");
  });

  it("reads Markdown line by line wherever it is scanned", () => {
    const md = "# Notes\n\nA seamless export\n";
    expect(scanFile("src/components/app/help.md", md)).toEqual([
      expect.objectContaining({ rule: "banned-phrase", line: 3 }),
    ]);
  });

  it("returns nothing for a file outside every scan root", () => {
    expect(scanFile("src/server/x.ts", 'export const t = "revolutionary \u2014 42";')).toEqual([]);
  });
});

describe("copy gate wiring, on a planted repo tree", () => {
  let root: string;
  const plant = (file: string, code: string) => {
    mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(root, file), code);
  };
  const bad = "export const P = () => <p>A seamless feed</p>;";

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "copy-gate-"));
    plant("src/app/(app)/app/reply/page.tsx", bad);
    plant("src/app/(admin)/admin/page.tsx", bad);
    plant("src/components/ui/button.tsx", bad);
    plant("src/components/app/card.tsx", "export const C = () => <p>87 match</p>;");
    plant("src/app/(marketing)/pricing/page.tsx", "export const P = () => <p>99 a month</p>;");
    plant("src/app/layout.tsx", bad);
    plant("emails/daily.ts", "export const subject = `Your favourite posts`;");
    plant("src/components/ui/button.test.tsx", bad);
    plant("src/app/login/page.tsx", "export const L = () => <p>Sign in</p>;");
    plant("src/app/api/health/route.ts", "export const x = 1;");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("reads every app root and both public roots, and skips test files", () => {
    const byFile = new Map<string, string[]>();
    for (const f of runCopyGate(deny, new Set(), root))
      byFile.set(f.file, [...(byFile.get(f.file) ?? []), f.rule]);
    expect(Object.fromEntries(byFile)).toEqual({
      "src/app/(app)/app/reply/page.tsx": ["banned-phrase"],
      "src/app/(admin)/admin/page.tsx": ["banned-phrase"],
      "src/components/ui/button.tsx": ["banned-phrase"],
      "src/app/(marketing)/pricing/page.tsx": ["unsourced-number"],
      "src/app/layout.tsx": ["banned-phrase"],
      "emails/daily.ts": ["uk-spelling"],
    });
  });

  it("scans every app root the denylist names", () => {
    for (const r of deny.copy.appScanRoots) expect(copyScanRoots(deny)).toContain(r);
    const files = copyGateFiles(deny, root);
    expect(files).toEqual(
      expect.arrayContaining([
        "src/app/(app)/app/reply/page.tsx",
        "src/app/(admin)/admin/page.tsx",
        "src/components/ui/button.tsx",
        "src/components/app/card.tsx",
      ]),
    );
  });

  it("reports a UI file that no scope covers, such as a page outside every route group", () => {
    expect(unscopedUiFiles(deny, root)).toEqual(["src/app/login/page.tsx"]);
  });
});

describe("remote font scanner", () => {
  it.each([
    ['@import url("https://fonts.googleapis.com/css2?family=Inter");', "a.css"],
    ["@import 'https://fonts.example.com/x.css';", "a.css"],
    ["  src: url(https://fonts.gstatic.com/s/inter.woff2);", "a.css"],
    ["  src: url('//cdn.example.com/f.woff2');", "a.scss"],
    ['import { Inter } from "next/font/google";', "src/app/layout.tsx"],
    ["const f = await import('next/font/google');", "src/app/x.ts"],
  ])("flags %s", (code, file) => {
    expect(rules(findRemoteFonts(code, file))).toEqual(["remote-font-or-style"]);
  });

  it.each([
    ['@import "tailwindcss";', "a.css"],
    ["  src: url(./files/fraunces.woff2);", "a.css"],
    ['import { GeistSans } from "geist/font/sans";', "src/app/layout.tsx"],
    ['import localFont from "next/font/local";', "src/app/layout.tsx"],
  ])("accepts %s", (code, file) => {
    expect(findRemoteFonts(code, file)).toEqual([]);
  });
});

describe("logo scanner", () => {
  it("flags platform logo files by name, case-insensitively, and ignores other files", () => {
    const findings = findLogoFiles(
      [
        "public/reddit-logo.svg",
        "public/Bluesky.PNG",
        "public/img/stripe-badge.webp",
        "public/og-image.png",
        "public/robots.txt",
        "public/reddit.txt",
      ],
      deny,
    );
    expect(findings.map((f) => f.file)).toEqual([
      "public/reddit-logo.svg",
      "public/Bluesky.PNG",
      "public/img/stripe-badge.webp",
    ]);
  });
});
