import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import {
  checkOwnSiteUrl,
  createOwnSiteFetch,
  isPublicAddress,
  lookupAnswer,
  readBody,
  OwnSiteError,
  type Resolve,
  type Transport,
  type TransportResponse,
} from "./own-site";
import { isPlatformHost, mentionsPlatformHost, PLATFORM_WEB_HOSTS } from "./platform-hosts";

/**
 * fetchOwnSite() (docs/PLAN.md 12.3): the one fetch that goes to a host the user gives us. It must
 * never reach a private address or a platform, directly or through a redirect. No test here
 * touches the network: the resolver is faked, and so is the transport except where a test proves
 * the real one refuses before it connects.
 */

const PUBLIC = "93.184.216.34";
const publicResolve: Resolve = async () => [{ address: PUBLIC, family: 4 }];

const html = (body = "<html><title>Acme</title></html>"): TransportResponse => ({
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
  body,
});
const redirect = (location: string): TransportResponse => ({
  status: 301,
  headers: { location },
  body: "",
});

/** A fake site: a map from URL to response, recording every URL requested. */
function fakeSite(pages: Record<string, TransportResponse>) {
  const requested: string[] = [];
  const transport: Transport = async ({ url }) => {
    requested.push(url.href);
    const page = pages[url.href];
    if (!page) return { status: 404, headers: { "content-type": "text/html" }, body: "" };
    return page;
  };
  return { transport, requested };
}

const fetcherFor = (pages: Record<string, TransportResponse>, resolve = publicResolve) => {
  const site = fakeSite(pages);
  return { get: createOwnSiteFetch({ resolve, transport: site.transport }), ...site };
};

async function refusedWith(
  promise: Promise<unknown>,
  code: OwnSiteError["code"],
): Promise<OwnSiteError> {
  const error = await promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(OwnSiteError);
  expect((error as OwnSiteError).code).toBe(code);
  return error as OwnSiteError;
}

describe("fetchOwnSite: the happy path", () => {
  it("returns the page text, its final URL and its type", async () => {
    const { get } = fetcherFor({ "https://acme.example/": html("<p>Invoices</p>") });
    expect(await get("https://acme.example/")).toEqual({
      url: "https://acme.example/",
      contentType: "text/html",
      body: "<p>Invoices</p>",
    });
  });

  it("follows a redirect on the same host and to its www twin", async () => {
    const { get, requested } = fetcherFor({
      "https://acme.example/": redirect("https://www.acme.example/"),
      "https://www.acme.example/": redirect("/home"),
      "https://www.acme.example/home": html(),
    });
    const page = await get("https://acme.example/");
    expect(page.url).toBe("https://www.acme.example/home");
    expect(requested).toEqual([
      "https://acme.example/",
      "https://www.acme.example/",
      "https://www.acme.example/home",
    ]);
  });

  it("accepts text/plain", async () => {
    const { get } = fetcherFor({
      "https://acme.example/llms.txt": {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "Acme makes invoices.",
      },
    });
    expect((await get("https://acme.example/llms.txt")).contentType).toBe("text/plain");
  });
});

describe("fetchOwnSite: refused URLs", () => {
  it.each([
    ["http", "http://acme.example/", "insecure_scheme"],
    ["ftp", "ftp://acme.example/", "insecure_scheme"],
    ["credentials", "https://user:pass@acme.example/", "credentials_in_url"],
    ["an odd port", "https://acme.example:8443/", "non_default_port"],
    ["garbage", "not a url", "invalid_url"],
    ["a single-label host", "https://intranet/", "invalid_host"],
    ["localhost", "https://localhost/", "invalid_host"],
    ["a .local host", "https://printer.local/", "invalid_host"],
    ["a .internal host", "https://metadata.google.internal/", "invalid_host"],
  ] as const)("refuses %s", async (_label, url, code) => {
    const { get, requested } = fetcherFor({});
    await refusedWith(get(url), code);
    expect(requested).toEqual([]);
  });

  it.each([
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.1/",
    "https://192.168.1.1/",
    "https://100.64.0.1/",
    "https://[fc00::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://2130706433/",
    "https://0x7f.1/",
    "https://8.8.8.8/",
  ])("refuses an IP address as the host: %s", async (url) => {
    const resolve = vi.fn(publicResolve);
    const { get, requested } = fetcherFor({}, resolve);
    await refusedWith(get(url), "ip_literal");
    expect(requested).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    "127.0.0.1",
    "::1",
    "169.254.169.254",
    "10.0.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "0.0.0.0",
    "172.16.5.4",
    "fe80::1",
  ])("refuses a hostname whose resolver returns %s", async (address) => {
    const { get, requested } = fetcherFor({ "https://acme.example/": html() }, async () => [
      { address, family: address.includes(":") ? 6 : 4 },
    ]);
    await refusedWith(get("https://acme.example/"), "private_address");
    expect(requested).toEqual([]);
  });

  it("refuses when any one resolved address is private", async () => {
    const { get } = fetcherFor({ "https://acme.example/": html() }, async () => [
      { address: PUBLIC, family: 4 },
      { address: "10.1.2.3", family: 4 },
    ]);
    await refusedWith(get("https://acme.example/"), "private_address");
  });

  it("refuses a host that does not resolve", async () => {
    const { get } = fetcherFor({}, async () => []);
    await refusedWith(get("https://acme.example/"), "network");
  });
});

/** Planted platform URLs (docs/TASKS.md, M2). */
const PLATFORM_URLS = [
  "https://www.reddit.com/r/x",
  "https://old.reddit.com",
  "https://redd.it/a",
  "https://x.com/a",
  "https://t.co/a",
  "https://www.linkedin.com/in/a",
  "https://lnkd.in/a",
  "https://youtu.be/a",
  "https://bsky.app/profile/a",
  "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=a",
  "https://news.ycombinator.com/item?id=1",
  "https://hn.algolia.com/api/v1/search?query=a",
  "https://www-reddit-com.translate.goog/r/x",
  "https://web.archive.org/web/2026/https://www.reddit.com/",
  "https://www.producthunt.com/products/a",
  "https://www.indiehackers.com/product/a",
  "https://www.facebook.com/a",
  "https://www.instagram.com/a",
  "https://www.threads.net/@a",
  "https://www.tiktok.com/@a",
  "https://discord.gg/a",
  "https://twitter.com/a",
  "https://archive.ph/abc",
  "https://webcache.googleusercontent.com/search?q=cache:x",
];

describe("fetchOwnSite: platforms are never fetched", () => {
  it.each(PLATFORM_URLS)("refuses %s as the first URL, without resolving it", async (url) => {
    const resolve = vi.fn(publicResolve);
    const { get, requested } = fetcherFor({ [url]: html() }, resolve);
    await refusedWith(get(url), "platform_host");
    expect(requested).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(PLATFORM_URLS)("refuses %s as a redirect target", async (url) => {
    const { get, requested } = fetcherFor({
      "https://acme.example/": redirect(url),
      [url]: html(),
    });
    // Off-site redirects are refused anyway; a platform target is named as such.
    await refusedWith(get("https://acme.example/"), "platform_host");
    expect(requested).toEqual(["https://acme.example/"]);
  });

  it.each([
    "https://reader.example/https://www.reddit.com/r/x",
    "https://reader.example/?url=https%3A%2F%2Fx.com%2Fa",
    "https://acme.example/go/linkedin.com/in/a",
  ])("refuses a URL whose path or query names a platform: %s", async (url) => {
    const { get, requested } = fetcherFor({ [url]: html() });
    await refusedWith(get(url), "platform_host");
    expect(requested).toEqual([]);
  });

  it("refuses a same-host redirect whose path names a platform", async () => {
    const { get, requested } = fetcherFor({
      "https://acme.example/": redirect("/out/https://www.reddit.com/r/x"),
    });
    await refusedWith(get("https://acme.example/"), "platform_host");
    expect(requested).toEqual(["https://acme.example/"]);
  });
});

/** Planted third-party pages, one or more per category (docs/TASKS.md, M2). */
const THIRD_PARTY_URLS = [
  "https://apps.apple.com/us/app/a/id1",
  "https://itunes.apple.com/app/id1",
  "https://play.google.com/store/apps/details?id=a",
  "https://chromewebstore.google.com/detail/a/b",
  "https://github.com/a/b",
  "https://gist.github.com/a/b",
  "https://www.npmjs.com/package/a",
  "https://pypi.org/project/a/",
  "https://www.g2.com/products/a/reviews",
  "https://www.capterra.com/p/1/a/",
  "https://www.trustpilot.com/review/a.example",
  "https://alternativeto.net/software/a/",
  "https://appsumo.com/products/a/",
  "https://medium.com/@a",
  "https://a.substack.com/",
  "https://mastodon.social/@a",
  "https://linktr.ee/a",
  "https://en.wikipedia.org/wiki/A",
];

describe("fetchOwnSite: someone else's site is never fetched", () => {
  it.each(THIRD_PARTY_URLS)("refuses %s without resolving it", async (url) => {
    const resolve = vi.fn(publicResolve);
    const { get, requested } = fetcherFor({ [url]: html() }, resolve);
    await refusedWith(get(url), "third_party_host");
    expect(requested).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(THIRD_PARTY_URLS)("refuses %s as a redirect target", async (url) => {
    const { get, requested } = fetcherFor({ "https://acme.example/": redirect(url) });
    await refusedWith(get("https://acme.example/"), "third_party_host");
    expect(requested).toEqual(["https://acme.example/"]);
  });

  it.each([
    "https://acme.example/@ana",
    "https://acme.example/~ana",
    "https://acme.example/u/ana",
    "https://acme.example/user/ana",
    "https://acme.example/users/ana",
    "https://acme.example/profile/ana",
    "https://acme.example/in/ana",
    "https://acme.example/people/ana",
    "https://acme.example/%40ana",
    "https://acme.example/en/@ana",
    "https://acme.example/forum/u/ana",
    "https://acme.example/team/@ana",
    "https://acme.example/pt-br/members/ana",
    "https://acme.example//@ana",
    "https://acme.example//users/ana",
    "https://acme.example///u/ana",
  ])("refuses the profile path %s on any host", async (url) => {
    const { get, requested } = fetcherFor({ [url]: html() });
    await refusedWith(get(url), "profile_path");
    expect(requested).toEqual([]);
  });

  it("refuses a same-site redirect to a profile path", async () => {
    const { get } = fetcherFor({ "https://acme.example/": redirect("/@ana") });
    await refusedWith(get("https://acme.example/"), "profile_path");
  });

  it.each([
    "https://acme.github.io/",
    "https://acme.example/docs/users/guide",
    "https://acme.example/info/people-ops",
    "https://acme.example/inbox",
    "https://acme.example/in/books/pricing",
  ])("still reads a product's own page: %s", async (url) => {
    const { get } = fetcherFor({ [url]: html() });
    await expect(get(url)).resolves.toMatchObject({ url });
  });
});

describe("fetchOwnSite: wrapped and embedded pages", () => {
  it.each([
    [
      "a reader proxy",
      "https://r.jina.ai/https://www.g2.com/products/acme/reviews",
      "platform_host",
    ],
    [
      "a reader proxy on another host",
      "https://reader.example/https://www.g2.com/products/a",
      "platform_host",
    ],
    [
      "an embedded URL in the query",
      "https://go.example/?to=https%3A%2F%2Facme.example%2F",
      "platform_host",
    ],
    [
      "a scheme-relative URL in the query",
      "https://go.example/?to=//acme.example/x",
      "platform_host",
    ],
    ["a double-encoded platform", "https://go.example/p/www.reddit%252Ecom/r/x", "platform_host"],
    ["an archive mirror short link", "https://archive.fo/AbCdE", "platform_host"],
    ["a host wrapping a platform", "https://www.reddit.com.proxy.example/r/x", "platform_host"],
    ["a hyphenated platform host", "https://www-reddit-com.proxy.example/r/x", "platform_host"],
    [
      "a third-party domain in the path",
      "https://go.example/u-r-l/github.com/ana",
      "third_party_host",
    ],
    [
      "fullwidth letters",
      "https://go.example/\uff52\uff45\uff44\uff44\uff49\uff54\u3002\uff43\uff4f\uff4d/r/x",
      "platform_host",
    ],
    ["a URL over 2,048 characters", `https://acme.example/${"a".repeat(2100)}`, "invalid_url"],
  ] as const)("refuses %s", async (_label, url, code) => {
    const { get, requested } = fetcherFor({ [url]: html() });
    await refusedWith(get(url), code);
    expect(requested).toEqual([]);
  });

  it.each([
    "https://acme.example/pricing",
    "https://acme.example/docs/getting-started",
    "https://cal-com-alternative.example/",
    "https://acme.example/blog/why-we-moved-off-spreadsheets",
  ])("still reads %s", async (url) => {
    const { get } = fetcherFor({ [url]: html() });
    await expect(get(url)).resolves.toMatchObject({ url });
  });
});

describe("fetchOwnSite: redirects and responses", () => {
  it("refuses a redirect to another domain", async () => {
    const { get, requested } = fetcherFor({
      "https://acme.example/": redirect("https://other.example/"),
      "https://other.example/": html(),
    });
    await refusedWith(get("https://acme.example/"), "redirect_off_site");
    expect(requested).toEqual(["https://acme.example/"]);
  });

  it.each([
    ["a sibling subdomain", "https://shop.acme.example/"],
    ["a lookalike", "https://acme.example.evil.example/"],
    ["a www of a www", "https://www.www.acme.example/"],
  ])("refuses a redirect to %s", async (_label, target) => {
    const { get } = fetcherFor({ "https://acme.example/": redirect(target) });
    await refusedWith(get("https://acme.example/"), "redirect_off_site");
  });

  it("refuses a redirect to http, to an IP, or to a private address", async () => {
    await refusedWith(
      fetcherFor({ "https://acme.example/": redirect("http://acme.example/") }).get(
        "https://acme.example/",
      ),
      "insecure_scheme",
    );
    await refusedWith(
      fetcherFor({ "https://acme.example/": redirect("https://10.0.0.1/") }).get(
        "https://acme.example/",
      ),
      "ip_literal",
    );
    let calls = 0;
    const rebinding: Resolve = async () => [
      { address: calls++ === 0 ? PUBLIC : "127.0.0.1", family: 4 },
    ];
    await refusedWith(
      fetcherFor({ "https://acme.example/": redirect("https://www.acme.example/") }, rebinding).get(
        "https://acme.example/",
      ),
      "private_address",
    );
  });

  it("stops after 3 redirects", async () => {
    const { get, requested } = fetcherFor({
      "https://acme.example/": redirect("/1"),
      "https://acme.example/1": redirect("/2"),
      "https://acme.example/2": redirect("/3"),
      "https://acme.example/3": redirect("/4"),
      "https://acme.example/4": html(),
    });
    await refusedWith(get("https://acme.example/"), "too_many_redirects");
    expect(requested).toHaveLength(4);
  });

  it.each([
    ["JSON", "application/json"],
    ["an image", "image/png"],
    ["a PDF", "application/pdf"],
    ["no type at all", undefined],
  ])("refuses %s", async (_label, type) => {
    const { get } = fetcherFor({
      "https://acme.example/": { status: 200, headers: { "content-type": type }, body: "{}" },
    });
    await refusedWith(get("https://acme.example/"), "unsupported_type");
  });

  it("refuses an error status and says which", async () => {
    const error = await refusedWith(
      fetcherFor({}).get("https://acme.example/missing"),
      "http_status",
    );
    expect(error.status).toBe(404);
  });

  it("refuses a body over 2 MB when the transport reports one", async () => {
    const big = "a".repeat(3 * 1024 * 1024);
    const { get } = fetcherFor({ "https://acme.example/": html(big) });
    await refusedWith(get("https://acme.example/"), "too_large");
  });

  it("gives up when the site takes longer than the time budget", async () => {
    const get = createOwnSiteFetch({
      resolve: publicResolve,
      transport: () => new Promise(() => {}),
      timeoutMs: 20,
    });
    await refusedWith(get("https://acme.example/"), "timeout");
  });

  it("asks the transport for no more than the body cap and sends no credentials", async () => {
    const seen: Parameters<Transport>[0][] = [];
    const get = createOwnSiteFetch({
      resolve: publicResolve,
      transport: async (req) => {
        seen.push(req);
        return html();
      },
    });
    await get("https://acme.example/");
    expect(seen[0]?.maxBytes).toBe(2 * 1024 * 1024);
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(["lookup", "maxBytes", "signal", "url"]);
  });
});

describe("the real https transport", () => {
  it("resolves again inside the connection and refuses a private answer before connecting", async () => {
    // First answer (the pre-check) public, second (node:https's own lookup) private: DNS rebinding.
    const asked: string[] = [];
    const resolve: Resolve = async (host) => {
      asked.push(host);
      return [{ address: asked.length === 1 ? PUBLIC : "169.254.169.254", family: 4 }];
    };
    const get = createOwnSiteFetch({ resolve });
    await refusedWith(get("https://acme.example/"), "private_address");
    expect(asked).toEqual(["acme.example", "acme.example"]);
  });
});

describe("limits", () => {
  it("can be tightened but never loosened past 12.3", async () => {
    const pages: Record<string, TransportResponse> = {};
    for (let i = 0; i < 8; i++) pages[`https://acme.example/${i}`] = redirect(`/${i + 1}`);
    const site = fakeSite(pages);
    const get = createOwnSiteFetch({
      resolve: publicResolve,
      transport: site.transport,
      maxRedirects: 10,
      maxBytes: 100 * 1024 * 1024,
      timeoutMs: 60_000,
    });
    await refusedWith(get("https://acme.example/0"), "too_many_redirects");
    expect(site.requested).toHaveLength(4);
  });
});

describe("isPublicAddress", () => {
  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2a00:1450:4009:81f::200e",
  ])("accepts %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "0.1.2.3",
    "10.255.255.255",
    "100.127.255.255",
    "127.8.8.8",
    "169.254.0.1",
    "172.31.0.1",
    "192.0.0.8",
    "192.0.2.1",
    "192.168.0.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:8.8.8.8",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::1%eth0",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "2001::1",
    "2002:a00:1::1",
    "2001:10::1",
    "3fff::1",
    "not an address",
    "1.2.3",
    "1.2.3.256",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("platform hosts", () => {
  it("covers every platform web host the sources gate checks", () => {
    for (const host of PLATFORM_WEB_HOSTS) expect(isPlatformHost(host), host).toBe(true);
  });

  it("matches subdomains and nothing that merely ends in the same letters", () => {
    expect(isPlatformHost("api.x.com")).toBe(true);
    expect(isPlatformHost("WWW.Reddit.COM.")).toBe(true);
    expect(isPlatformHost("box.com")).toBe(false);
    expect(isPlatformHost("notreddit.com")).toBe(false);
    expect(isPlatformHost("acme.example")).toBe(false);
  });

  it("finds a platform named in a path or query, but not in ordinary words", () => {
    expect(mentionsPlatformHost(new URL("https://a.example/https://www.reddit.com/r/x"))).toBe(
      true,
    );
    expect(mentionsPlatformHost(new URL("https://a.example/?u=https%3A%2F%2Ft.co%2Fa"))).toBe(true);
    expect(mentionsPlatformHost(new URL("https://a.example/blog/reddit-marketing"))).toBe(false);
    expect(mentionsPlatformHost(new URL("https://a.example/pricing"))).toBe(false);
  });
});

describe("checks cost linear time", () => {
  it("a 1 MB path is refused fast, and the mention matchers stay linear", () => {
    const long = new URL(`https://acme.example/${"a.".repeat(500_000)}x`);
    const start = performance.now();
    expect(() => checkOwnSiteUrl(long)).toThrow(OwnSiteError);
    expect(mentionsPlatformHost(long)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});

describe("readBody (the real transport's body limits)", () => {
  const MAX = 2 * 1024 * 1024;
  const html = { "content-type": "text/html; charset=utf-8" };

  it("reads a small body and decodes its charset", async () => {
    const latin = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "cafe" with e-acute in windows-1252
    const body = await readBody(
      Readable.from([latin]),
      { "content-type": "text/html; charset=windows-1252" },
      MAX,
      "acme.example",
    );
    expect(body).toBe("caf\u00e9");
  });

  it("decompresses gzip", async () => {
    const zipped = gzipSync(Buffer.from("<p>Acme</p>"));
    const body = await readBody(
      Readable.from([zipped]),
      { ...html, "content-encoding": "gzip" },
      MAX,
      "acme.example",
    );
    expect(body).toBe("<p>Acme</p>");
  });

  it("stops a 3 MB body at the cap", async () => {
    const chunks = Array.from({ length: 48 }, () => Buffer.alloc(64 * 1024, 97));
    await expect(readBody(Readable.from(chunks), html, MAX, "acme.example")).rejects.toMatchObject({
      code: "too_large",
    });
  });

  it("stops a compression bomb at the cap, counting decompressed bytes", async () => {
    const bomb = gzipSync(Buffer.alloc(50 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(MAX);
    const start = performance.now();
    await expect(
      readBody(Readable.from([bomb]), { ...html, "content-encoding": "gzip" }, MAX, "acme.example"),
    ).rejects.toMatchObject({ code: "too_large" });
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it("refuses a declared length over the cap without reading", async () => {
    let read = false;
    const stream = new Readable({
      read() {
        read = true;
        this.push(null);
      },
    });
    await expect(
      readBody(stream, { ...html, "content-length": String(MAX + 1) }, MAX, "acme.example"),
    ).rejects.toMatchObject({ code: "too_large" });
    expect(read).toBe(false);
  });

  it("refuses an encoding it cannot decode", async () => {
    await expect(
      readBody(Readable.from(["x"]), { ...html, "content-encoding": "zstd" }, MAX, "acme.example"),
    ).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("fails fast when the body breaks off mid-stream, with or without gzip", async () => {
    for (const encoding of [undefined, "gzip"]) {
      const broken = new Readable({
        read() {
          this.destroy(new Error("socket hang up"));
        },
      });
      await expect(
        readBody(broken, { ...html, "content-encoding": encoding }, MAX, "acme.example"),
      ).rejects.toMatchObject({ code: "network" });
    }
  });
});

describe("lookupAnswer", () => {
  const both = [
    { address: "93.184.216.34", family: 4 as const },
    { address: "2606:2800:220:1::1", family: 6 as const },
  ];

  it("hands node the whole list when it asks for all (Happy Eyeballs)", () => {
    expect(lookupAnswer(both, { all: true })).toEqual({ all: both });
  });

  it("hands node one address and its family otherwise", () => {
    expect(lookupAnswer(both, {})).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("filters to the family node asked for, or answers nothing", () => {
    expect(lookupAnswer(both, { family: 6 })).toEqual({ address: "2606:2800:220:1::1", family: 6 });
    expect(lookupAnswer([both[0]!], { family: 6, all: true })).toBeNull();
  });
});

describe("the module's surface", () => {
  it("exports fetchOwnSite, its factory, the error and pure helpers, never the transport", async () => {
    const mod = await import("./own-site");
    expect(Object.keys(mod).sort()).toEqual([
      "MAX_OWN_SITE_URL",
      "OWN_SITE_USER_AGENT",
      "OwnSiteError",
      "checkOwnSiteUrl",
      "createOwnSiteFetch",
      "fetchOwnSite",
      "isPublicAddress",
      "isSameSite",
      "lookupAnswer",
      "readBody",
    ]);
  });
});
