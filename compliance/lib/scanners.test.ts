import { describe, expect, it } from "vitest";
import { installTargets, isBlockedPackage, loadDenylist, packageName } from "./denylist.mjs";
import { claimNumbers, checkCopy, extractCopy, findLogoFiles } from "./scan-copy";
import { findBlockedPackages, lockfileName } from "./scan-deps";
import {
  FETCH_WRAPPER_FILE,
  findNetworkPrimitives,
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
  ])("flags a claim that hides the data provider (docs/PLAN.md, D12): %s", (phrase) => {
    expect(rules(scan(`export const A = () => <p>${phrase}</p>;`))).toContain("banned-phrase");
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
