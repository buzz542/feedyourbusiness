import { describe, expect, it, vi } from "vitest";
import {
  OWN_SITE_MAX_BYTES,
  OwnSiteError,
  createFetchOwnSite,
  createOwnSiteLookup,
  fetchOwnSite,
  type OwnSiteResolver,
  type OwnSiteTransport,
} from "./own-site";
import { PLATFORM_DOMAINS, PLATFORM_WEB_HOSTS, isPlatformHost } from "./platform-hosts";
import { THIRD_PARTY_HOSTS, isProfilePath, isThirdPartyHost } from "./third-party-hosts";

/**
 * fetchOwnSite() (docs/PLAN.md 12.3): the one other way the app reaches the network. It reads the
 * user's own site and nothing else: no platform, no store, review or profile site, no private
 * address, at connect time as well as before.
 */

const PUBLIC = "93.184.215.14";

interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array | Uint8Array[];
  /** Never answers, or never finishes the body. */
  hang?: "headers" | "body";
}

/**
 * A fake transport that behaves like node:https where it matters: it resolves the host through the
 * lookup it is handed, exactly as a socket connect would, and only then serves the route. The
 * resolver goes into the factory options, so tests never touch real DNS.
 */
function fakeSite(
  routes: Record<string, Route>,
  resolve: OwnSiteResolver = async () => [{ address: PUBLIC, family: 4 }],
) {
  const served: string[] = [];
  const connectedTo: string[] = [];
  const closed: string[] = [];
  const headersSent: Record<string, string>[] = [];

  const transport: OwnSiteTransport = {
    async get({ url, headers, lookup, signal }) {
      const addresses = await new Promise<{ address: string; family: number }[]>((ok, fail) =>
        lookup(url.hostname, { all: true }, (error, result) =>
          error ? fail(error) : ok(result as { address: string; family: number }[]),
        ),
      );
      connectedTo.push(...addresses.map((a) => a.address));
      served.push(url.href);
      headersSent.push({ ...headers });
      const route = routes[url.href];
      if (!route) return response(url.href, { status: 404, body: "not found" }, signal, closed);
      if (route.hang === "headers") return new Promise(() => {});
      return response(url.href, route, signal, closed);
    },
  };
  return { options: { transport, resolve }, served, connectedTo, closed, headersSent };
}

function response(href: string, route: Route, signal: AbortSignal, closed: string[]) {
  const chunks =
    route.body === undefined
      ? []
      : typeof route.body === "string"
        ? [new TextEncoder().encode(route.body)]
        : route.body instanceof Uint8Array
          ? [route.body]
          : route.body;
  async function* body() {
    for (const chunk of chunks) yield chunk;
    if (route.hang === "body")
      await new Promise((_, fail) => signal.addEventListener("abort", fail));
  }
  return {
    status: route.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...route.headers },
    body: body(),
    close: () => closed.push(href),
  };
}

const html = (text: string): Route => ({ body: `<html><body>${text}</body></html>` });
const redirect = (location: string, status = 301): Route => ({
  status,
  headers: { location },
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OwnSiteError) return error.code;
    throw error;
  }
  return "no_error";
}

describe("fetchOwnSite: the user's own site", () => {
  it("reads a public https page and returns its text", async () => {
    const site = fakeSite({ "https://acme.example/": html("Acme makes invoices") });
    const read = createFetchOwnSite(site.options);

    const page = await read("https://acme.example/");

    expect(page).toMatchObject({
      status: 200,
      url: "https://acme.example/",
      contentType: "text/html",
    });
    expect(page.text).toContain("Acme makes invoices");
    expect(site.connectedTo).toEqual([PUBLIC]);
  });

  it("sends a descriptive User-Agent with a contact link, asks for no compression and sends no cookie", async () => {
    const site = fakeSite({ "https://acme.example/": html("hi") });
    await createFetchOwnSite(site.options)("https://acme.example/");

    const sent = site.headersSent[0] ?? {};
    expect(sent["user-agent"]).toMatch(/^AskedFor\/\d/);
    expect(sent["user-agent"]).toMatch(/\+https:\/\/askedfor\.app\//);
    expect(sent["accept-encoding"]).toBe("identity");
    expect(Object.keys(sent).map((k) => k.toLowerCase())).not.toContain("cookie");
    expect(Object.keys(sent).map((k) => k.toLowerCase())).not.toContain("authorization");
  });

  it("accepts text/plain, as robots.txt is served", async () => {
    const site = fakeSite({
      "https://acme.example/robots.txt": {
        headers: { "content-type": "TEXT/PLAIN" },
        body: "User-agent: *\nDisallow: /admin",
      },
    });
    const page = await createFetchOwnSite(site.options)("https://acme.example/robots.txt");
    expect(page.contentType).toBe("text/plain");
    expect(page.text).toContain("Disallow: /admin");
  });

  it("decodes the charset the server names", async () => {
    const site = fakeSite({
      "https://acme.example/": {
        headers: { "content-type": "text/html; charset=windows-1252" },
        body: new Uint8Array([0x93, 0x68, 0x69, 0x94]),
      },
    });
    const page = await createFetchOwnSite(site.options)("https://acme.example/");
    expect(page.text).toBe("“hi”");
  });

  it("returns a non-2xx status without reading the body", async () => {
    const site = fakeSite({
      "https://acme.example/robots.txt": { status: 404, body: "x".repeat(10) },
      "https://acme.example/down": { status: 503, headers: { "content-type": "image/png" } },
    });
    const read = createFetchOwnSite(site.options);

    expect(await read("https://acme.example/robots.txt")).toMatchObject({ status: 404, text: "" });
    expect(await read("https://acme.example/down")).toMatchObject({
      status: 503,
      contentType: null,
      text: "",
    });
    expect(site.closed).toEqual(["https://acme.example/robots.txt", "https://acme.example/down"]);
  });
});

describe("fetchOwnSite: refused before anything is fetched", () => {
  const refusedWithoutFetching = async (url: string, code: string) => {
    const site = fakeSite({});
    expect(await codeOf(createFetchOwnSite(site.options)(url))).toBe(code);
    expect(site.served).toEqual([]);
  };

  it.each([
    ["http://", "http://acme.example/", "insecure_scheme"],
    ["ftp", "ftp://acme.example/", "insecure_scheme"],
    ["credentials", "https://user:pass@acme.example/", "credentials_in_url"],
    ["a username alone", "https://user@acme.example/", "credentials_in_url"],
    ["an odd port", "https://acme.example:8443/", "non_default_port"],
    ["not a URL", "acme", "invalid_url"],
    ["a public IP literal", "https://8.8.8.8/", "ip_literal"],
  ])("refuses %s", async (_label, url, code) => {
    await refusedWithoutFetching(url, code);
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
  ])("refuses the private address %s", async (url) => {
    await refusedWithoutFetching(url, "blocked_address");
  });

  it.each([
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
    "https://REDDIT.com./r/x",
    "https://reddit.com../r/x",
  ])("refuses the platform URL %s", async (url) => {
    await refusedWithoutFetching(url, "platform_host");
  });

  it.each([
    "https://safereddit.com/r/x",
    "https://redlib.anyhost.example/r/x",
    "https://libreddit.anyhost.example/r/x",
    "https://teddit.anyhost.example/r/x",
    "https://nitter.privacydev.net/a/status/1",
    "https://inv.nadeko.net/watch?v=a",
    "https://invidious.anyhost.example/watch?v=a",
    "https://piped.kavin.rocks/watch?v=a",
    "https://pipedapi-libre.anyhost.example/streams/a",
    "https://proxitok.anyhost.example/@a",
    "https://www-reddit-com.proxy.example/r/x",
    "https://news-ycombinator-com.proxy.example/item?id=1",
  ])("refuses the platform front end or proxy %s", async (url) => {
    await refusedWithoutFetching(url, "platform_host");
  });

  it.each(["https://acme..example/", "https://.acme.example/"])(
    "refuses the empty host label in %s",
    async (url) => {
      await refusedWithoutFetching(url, "invalid_url");
    },
  );

  it("refuses every platform domain in platform-hosts.ts, and every subdomain of one", async () => {
    expect(PLATFORM_DOMAINS.length).toBeGreaterThan(40);
    for (const domain of PLATFORM_DOMAINS) {
      await refusedWithoutFetching(`https://${domain}/`, "platform_host");
      await refusedWithoutFetching(`https://deep.sub.${domain}/`, "platform_host");
    }
  });

  it("refuses any URL whose path or query names a platform domain, whatever its host", async () => {
    for (const url of [
      "https://reader.example/https://www.reddit.com/r/x",
      "https://reader.example/?url=https%3A%2F%2Fwww.reddit.com%2Fr%2Fx",
      "https://reader.example/?url=https%253A%252F%252Fx.com%252Fa",
      "https://reader.example/?url=https%25253A%25252F%25252Freddit.com%25252Fr",
      "https://acme.example/read/x.com/a",
      "https://acme.example/?u=news.ycombinator.com",
    ]) {
      await refusedWithoutFetching(url, "names_platform");
    }
    for (const domain of PLATFORM_DOMAINS) {
      await refusedWithoutFetching(`https://acme.example/?u=${domain}`, "names_platform");
    }
  });

  it.each([
    ["an app store", "https://apps.apple.com/us/app/a/id1"],
    ["a code host", "https://github.com/a/b"],
    ["a package registry", "https://www.npmjs.com/package/a"],
    ["a review site", "https://www.g2.com/products/a/reviews"],
    ["a listing site", "https://www.capterra.com/p/1/a/"],
    ["a review site", "https://www.trustpilot.com/review/a.example"],
    ["a publishing site", "https://medium.com/@a"],
    ["a profile site", "https://mastodon.social/@a"],
    ["a link page", "https://linktr.ee/a"],
    ["a listing site's country domain", "https://www.capterra.co.uk/p/1/a/"],
    ["a listing site's country domain", "https://www.getapp.com.au/a"],
    ["a store's country domain", "https://www.amazon.de/dp/a"],
  ])("refuses %s: %s", async (_label, url) => {
    await refusedWithoutFetching(url, "third_party_host");
  });

  it("refuses every host in each third-party category, and every subdomain of one", async () => {
    for (const [category, hosts] of Object.entries(THIRD_PARTY_HOSTS)) {
      expect(hosts.length, category).toBeGreaterThan(4);
      for (const host of hosts) {
        await refusedWithoutFetching(`https://${host}/`, "third_party_host");
        await refusedWithoutFetching(`https://sub.${host}/`, "third_party_host");
      }
    }
  });

  it.each([
    "https://acme.example/@a",
    "https://acme.example/u/a",
    "https://acme.example/user/a",
    "https://acme.example/users/a",
    "https://acme.example/profile/a",
    "https://acme.example/in/a",
    "https://acme.example/people/a",
    "https://acme.example/en/user/a",
    "https://acme.example/~a/",
    "https://acme.example/%40a",
    "https://acme.example/U/a",
    "https://acme.example/u%2Fa",
    "https://acme.example/%2540a",
  ])("refuses the profile path %s", async (url) => {
    await refusedWithoutFetching(url, "profile_path");
  });
});

describe("fetchOwnSite: allowed lookalikes", () => {
  it.each([
    "https://acme.example/pricing",
    "https://acme.example/users",
    "https://acme.example/in",
    "https://acme.example/user-guide/start",
    "https://acme.example/inbox/a",
    "https://acme.example/docs/integrations",
    "https://acme.example/contact/hello@acme.example",
    "https://netflix-for-invoices.example/",
    "https://fox.com.example/",
    "https://acme.example/?q=reddit",
    "https://acme.example/compare/acmex.com",
    // A maker's own site about a platform is not a platform front end.
    "https://notreddit.com/",
    "https://redditlead.example/",
    "https://twitter-tools.example/",
    "https://acme.example/blog/nitter-alternatives",
    "https://pipedrive.example/",
    "https://mygithub.com/",
    "https://acme.github.io/",
    "https://acme.vercel.app/",
    "https://acme.s3.amazonaws.com/",
  ])("reads %s", async (url) => {
    const site = fakeSite({ [new URL(url).href]: html("ok") });
    expect((await createFetchOwnSite(site.options)(url)).status).toBe(200);
  });

  it("checks profile paths as whole path segments", () => {
    expect(isProfilePath("/users/a")).toBe(true);
    expect(isProfilePath("/users")).toBe(false);
    expect(isProfilePath("/users/")).toBe(false);
    expect(isProfilePath("/userguide/a")).toBe(false);
  });
});

describe("fetchOwnSite: redirects", () => {
  it("follows a same-host redirect", async () => {
    const site = fakeSite({
      "https://acme.example/": redirect("/home"),
      "https://acme.example/home": html("home"),
    });
    const page = await createFetchOwnSite(site.options)("https://acme.example/");
    expect(page.url).toBe("https://acme.example/home");
    expect(page.text).toContain("home");
    expect(site.closed).toContain("https://acme.example/");
  });

  it("follows a redirect to the www twin and back", async () => {
    const site = fakeSite({
      "https://acme.example/": redirect("https://www.acme.example/", 308),
      "https://www.acme.example/": redirect("https://acme.example/start", 302),
      "https://acme.example/start": html("start"),
    });
    const page = await createFetchOwnSite(site.options)("https://acme.example/");
    expect(page.url).toBe("https://acme.example/start");
  });

  it.each([
    ["another domain", "https://partner.example/", "redirect_off_site"],
    ["a subdomain that is not the www twin", "https://app.acme.example/", "redirect_off_site"],
    ["http", "http://acme.example/", "insecure_scheme"],
    ["an odd port", "https://acme.example:8443/", "non_default_port"],
    ["a private address", "https://10.0.0.1/", "blocked_address"],
    ["a profile path", "/user/a", "profile_path"],
    ["a path naming a platform", "/go?to=www.reddit.com", "names_platform"],
  ])("refuses a redirect to %s", async (_label, location, code) => {
    const site = fakeSite({ "https://acme.example/": redirect(location) });
    expect(await codeOf(createFetchOwnSite(site.options)("https://acme.example/"))).toBe(code);
    expect(site.served).toEqual(["https://acme.example/"]);
  });

  it("refuses every planted platform URL as a redirect target", async () => {
    for (const target of [
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
      "https://safereddit.com/r/x",
      "https://redlib.anyhost.example/r/x",
      "https://nitter.privacydev.net/a/status/1",
      "https://inv.nadeko.net/watch?v=a",
      "https://piped.kavin.rocks/watch?v=a",
      "https://www-reddit-com.proxy.example/r/x",
    ]) {
      const site = fakeSite({ "https://acme.example/": redirect(target, 302) });
      const code = await codeOf(createFetchOwnSite(site.options)("https://acme.example/"));
      expect(code, target).toBe("platform_host");
      expect(site.served).toEqual(["https://acme.example/"]);
    }
  });

  it("refuses a third-party host as a redirect target", async () => {
    const site = fakeSite({ "https://acme.example/": redirect("https://github.com/a/b") });
    expect(await codeOf(createFetchOwnSite(site.options)("https://acme.example/"))).toBe(
      "third_party_host",
    );
  });

  it("stops after 3 redirects", async () => {
    const site = fakeSite({
      "https://acme.example/": redirect("/1"),
      "https://acme.example/1": redirect("/2"),
      "https://acme.example/2": redirect("/3"),
      "https://acme.example/3": redirect("/4"),
      "https://acme.example/4": html("too far"),
    });
    expect(await codeOf(createFetchOwnSite(site.options)("https://acme.example/"))).toBe(
      "too_many_redirects",
    );
    expect(site.served).toHaveLength(4);
  });

  it("refuses a redirect with an unparseable location", async () => {
    const site = fakeSite({ "https://acme.example/": redirect("https://[bad") });
    expect(await codeOf(createFetchOwnSite(site.options)("https://acme.example/"))).toBe(
      "invalid_url",
    );
  });
});

describe("fetchOwnSite: addresses are checked at connect time", () => {
  it.each([
    "127.0.0.1",
    "::1",
    "169.254.169.254",
    "10.0.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ])("refuses a hostname whose resolver returns %s", async (address) => {
    const site = fakeSite({ "https://acme.example/": html("internal") }, async () => [
      { address, family: address.includes(":") ? 6 : 4 },
    ]);
    expect(await codeOf(createFetchOwnSite(site.options)("https://acme.example/"))).toBe(
      "blocked_address",
    );
    expect(site.served).toEqual([]);
  });

  it("refuses a hostname that resolves to a public and a private address", async () => {
    const site = fakeSite({ "https://acme.example/": html("x") }, async () => [
      { address: PUBLIC, family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    expect(await codeOf(createFetchOwnSite(site.options)("https://acme.example/"))).toBe(
      "blocked_address",
    );
  });

  it("refuses a private answer on a later connection (DNS rebinding)", async () => {
    const answers = [PUBLIC, "127.0.0.1"];
    const resolve = vi.fn<OwnSiteResolver>(async () => [
      { address: answers.shift() ?? "127.0.0.1", family: 4 },
    ]);
    const site = fakeSite(
      {
        "https://acme.example/": redirect("/next"),
        "https://acme.example/next": html("internal"),
      },
      resolve,
    );
    expect(await codeOf(createFetchOwnSite(site.options)("https://acme.example/"))).toBe(
      "blocked_address",
    );
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(site.connectedTo).toEqual([PUBLIC]);
    expect(site.served).toEqual(["https://acme.example/"]);
  });

  it("reports a name that does not resolve as dns_failed", async () => {
    const empty = fakeSite({}, async () => []);
    expect(await codeOf(createFetchOwnSite(empty.options)("https://acme.example/"))).toBe(
      "dns_failed",
    );

    const failing = fakeSite({}, async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    });
    expect(await codeOf(createFetchOwnSite(failing.options)("https://acme.example/"))).toBe(
      "dns_failed",
    );
  });

  it("answers both lookup forms Node uses, honoring the family it asks for", async () => {
    const lookup = createOwnSiteLookup(async () => [
      { address: "2606:4700:4700::1111", family: 6 },
      { address: PUBLIC, family: 4 },
    ]);
    const single = await new Promise<unknown[]>((ok) =>
      lookup("acme.example", { family: 4 }, (error, address, family) =>
        ok([error, address, family]),
      ),
    );
    expect(single).toEqual([null, PUBLIC, 4]);

    const all = await new Promise<unknown>((ok) =>
      lookup("acme.example", { all: true }, (_error, addresses) => ok(addresses)),
    );
    expect(all).toEqual([
      { address: "2606:4700:4700::1111", family: 6 },
      { address: PUBLIC, family: 4 },
    ]);
  });

  it("wires the lookup into node:https, so a private answer never opens a socket", async () => {
    const resolve = vi.fn<OwnSiteResolver>(async () => [{ address: "10.0.0.1", family: 4 }]);
    const read = createFetchOwnSite({ resolve });
    expect(await codeOf(read("https://acme.example/"))).toBe("blocked_address");
    expect(resolve).toHaveBeenCalledWith("acme.example");
  });
});

describe("fetchOwnSite: what it will read", () => {
  it.each([
    ["JSON", "application/json"],
    ["an image", "image/png"],
    ["XHTML", "application/xhtml+xml"],
    ["a missing type", ""],
  ])("refuses %s", async (_label, type) => {
    const site = fakeSite({
      "https://acme.example/": { headers: { "content-type": type }, body: "{}" },
    });
    expect(await codeOf(createFetchOwnSite(site.options)("https://acme.example/"))).toBe(
      "unsupported_type",
    );
    expect(site.closed).toEqual(["https://acme.example/"]);
  });

  it("refuses a compressed body it did not ask for", async () => {
    const site = fakeSite({
      "https://acme.example/": { headers: { "content-encoding": "gzip" }, body: "x" },
    });
    expect(await codeOf(createFetchOwnSite(site.options)("https://acme.example/"))).toBe(
      "unsupported_encoding",
    );
  });

  it("refuses a 3 MB body announced by Content-Length without reading it", async () => {
    const site = fakeSite({
      "https://acme.example/": {
        headers: { "content-length": String(3 * 1024 * 1024) },
        body: "small",
      },
    });
    expect(await codeOf(createFetchOwnSite(site.options)("https://acme.example/"))).toBe(
      "body_too_large",
    );
    expect(site.closed).toEqual(["https://acme.example/"]);
  });

  it("refuses a 3 MB body sent without a length, and stops reading", async () => {
    const chunk = new Uint8Array(256 * 1024).fill(0x61);
    const site = fakeSite({
      "https://acme.example/": { body: Array.from({ length: 12 }, () => chunk) },
    });
    expect(await codeOf(createFetchOwnSite(site.options)("https://acme.example/"))).toBe(
      "body_too_large",
    );
    expect(site.closed).toEqual(["https://acme.example/"]);
  });

  it("reads a body of exactly the cap", async () => {
    const site = fakeSite({
      "https://acme.example/": { body: new Uint8Array(OWN_SITE_MAX_BYTES).fill(0x61) },
    });
    const page = await createFetchOwnSite(site.options)("https://acme.example/");
    expect(page.text).toHaveLength(OWN_SITE_MAX_BYTES);
    expect(OWN_SITE_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it("times out a server that never answers", async () => {
    const site = fakeSite({ "https://acme.example/": { hang: "headers" } });
    const read = createFetchOwnSite({ ...site.options, timeoutMs: 20 });
    expect(await codeOf(read("https://acme.example/"))).toBe("timeout");
  });

  it("times out a body that never ends", async () => {
    const site = fakeSite({ "https://acme.example/": { hang: "body", body: "<html>" } });
    const read = createFetchOwnSite({ ...site.options, timeoutMs: 20 });
    expect(await codeOf(read("https://acme.example/"))).toBe("timeout");
    expect(site.closed).toEqual(["https://acme.example/"]);
  });

  it("stops when the caller's signal aborts", async () => {
    const site = fakeSite({ "https://acme.example/": { hang: "headers" } });
    const controller = new AbortController();
    const pending = createFetchOwnSite(site.options)("https://acme.example/", {
      signal: controller.signal,
    });
    controller.abort();
    expect(await codeOf(pending)).toBe("timeout");
  });

  it("reports a transport failure as network_error", async () => {
    const transport: OwnSiteTransport = {
      get: async () => {
        throw new Error("socket hang up");
      },
    };
    expect(await codeOf(createFetchOwnSite({ transport })("https://acme.example/"))).toBe(
      "network_error",
    );
  });
});

describe("platform and third-party host lists", () => {
  it("covers the platforms the plan names (2.1.10, 12.3)", () => {
    for (const domain of [
      "reddit.com",
      "redd.it",
      "redditmedia.com",
      "x.com",
      "twitter.com",
      "t.co",
      "linkedin.com",
      "lnkd.in",
      "facebook.com",
      "fb.com",
      "fb.me",
      "instagram.com",
      "threads.net",
      "threads.com",
      "tiktok.com",
      "youtube.com",
      "youtu.be",
      "discord.com",
      "discord.gg",
      "bsky.app",
      "bsky.social",
      "api.bsky.chat",
      "plc.directory",
      "tiktokapis.com",
      "youtube.googleapis.com",
      "ycombinator.com",
      "hn.algolia.com",
      "hacker-news.firebaseio.com",
      "producthunt.com",
      "indiehackers.com",
      "translate.goog",
      "web.archive.org",
      "archive.org",
      "archive.ph",
      "archive.today",
      "ghostarchive.org",
      "webcache.googleusercontent.com",
    ]) {
      expect(isPlatformHost(domain), domain).toBe(true);
    }
  });

  it("holds lowercase hostnames only, no duplicates, no overlap between the lists", () => {
    const thirdParty = Object.values(THIRD_PARTY_HOSTS).flat();
    for (const host of [...PLATFORM_DOMAINS, ...thirdParty]) {
      expect(host, host).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    }
    expect(new Set(PLATFORM_DOMAINS).size).toBe(PLATFORM_DOMAINS.length);
    expect(new Set(thirdParty).size).toBe(thirdParty.length);
    expect(thirdParty.filter((h) => isPlatformHost(h))).toEqual([]);
    expect(PLATFORM_DOMAINS.filter((h) => isThirdPartyHost(h))).toEqual([]);
  });

  it("names the web hosts where posts live, every one a platform host", () => {
    expect(PLATFORM_WEB_HOSTS).toEqual(
      expect.arrayContaining(["www.reddit.com", "old.reddit.com", "x.com", "bsky.app"]),
    );
    for (const host of PLATFORM_WEB_HOSTS) expect(isPlatformHost(host), host).toBe(true);
  });

  it("never treats a site hosting service as a third party: those hold the user's own site", () => {
    for (const host of [
      "acme.github.io",
      "acme.vercel.app",
      "acme.netlify.app",
      "acme.pages.dev",
    ]) {
      expect(isThirdPartyHost(host), host).toBe(false);
      expect(isPlatformHost(host), host).toBe(false);
    }
  });

  it("refuses a platform without a lookup or a connection", async () => {
    const resolve = vi.fn<OwnSiteResolver>(async () => [{ address: PUBLIC, family: 4 }]);
    const get = vi.fn<OwnSiteTransport["get"]>(async () => {
      throw new Error("must not connect");
    });
    const read = createFetchOwnSite({ resolve, transport: { get } });
    expect(await codeOf(read("https://www.reddit.com/r/x"))).toBe("platform_host");
    expect(resolve).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("exports a wired instance", () => {
    expect(typeof fetchOwnSite).toBe("function");
  });
});
