import { describe, expect, it } from "vitest";
import {
  createFetchOwnSite,
  fetchOwnSite,
  OwnSiteError,
  type RawResponse,
  type ResolvedAddress,
  type Transport,
} from "./own-site";

/**
 * fetchOwnSite (docs/PLAN.md 12.3): the user's own product page, once, for the onboarding draft.
 * Fakes stand in for DNS and the connection; no test here reaches the network.
 */

const PUBLIC: ResolvedAddress[] = [{ address: "93.184.215.14", family: 4 }];

interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array[];
}

/** A transport that behaves like https.request: it resolves through the lookup it is given. */
function fakeTransport(routes: Record<string, Route>) {
  const sent: string[] = [];
  const transport: Transport = async ({ url, lookup, signal }) => {
    await new Promise<void>((resolve, reject) =>
      lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true }, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    sent.push(url.href);
    const route = routes[url.href];
    if (!route) throw new Error(`no route for ${url.href}`);
    if (route.status === -1) {
      // Never answers: only the timeout can end it.
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    }
    const chunks =
      typeof route.body === "string"
        ? [new TextEncoder().encode(route.body)]
        : (route.body ?? [new TextEncoder().encode("<html><body>ok</body></html>")]);
    const response: RawResponse = {
      status: route.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...route.headers },
      body: (async function* () {
        yield* chunks;
      })(),
      abort: () => {},
    };
    return response;
  };
  return { transport, sent };
}

const resolver =
  (table: Record<string, ResolvedAddress[]> = {}) =>
  async (host: string) =>
    table[host] ?? PUBLIC;

async function refused(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(OwnSiteError);
  expect((error as OwnSiteError).code).toBe(code);
}

describe("fetchOwnSite: what it fetches", () => {
  it("fetches an https page and returns its text", async () => {
    const { transport } = fakeTransport({
      "https://myproduct.example/": { body: "<html><title>My product</title></html>" },
    });
    const fetchSite = createFetchOwnSite({ resolve: resolver(), transport });
    expect(await fetchSite("https://myproduct.example/")).toEqual({
      url: "https://myproduct.example/",
      contentType: "text/html",
      body: "<html><title>My product</title></html>",
    });
  });

  it("accepts text/plain", async () => {
    const { transport } = fakeTransport({
      "https://myproduct.example/": { headers: { "content-type": "text/plain" }, body: "hello" },
    });
    const fetchSite = createFetchOwnSite({ resolve: resolver(), transport });
    expect((await fetchSite("https://myproduct.example/")).contentType).toBe("text/plain");
  });

  it("follows a redirect on the same host, and to its www twin and back", async () => {
    const { transport, sent } = fakeTransport({
      "https://myproduct.example/": { status: 301, headers: { location: "/home" } },
      "https://myproduct.example/home": {
        status: 302,
        headers: { location: "https://www.myproduct.example/home" },
      },
      "https://www.myproduct.example/home": {
        status: 307,
        headers: { location: "https://myproduct.example/final" },
      },
      "https://myproduct.example/final": { body: "<p>done</p>" },
    });
    const fetchSite = createFetchOwnSite({ resolve: resolver(), transport });
    const page = await fetchSite("https://myproduct.example/");
    expect(page.url).toBe("https://myproduct.example/final");
    expect(sent).toHaveLength(4);
  });
});

describe("fetchOwnSite: what it refuses before connecting", () => {
  const nothingSent = async (url: string, code: string, table = {}) => {
    const { transport, sent } = fakeTransport({});
    await refused(createFetchOwnSite({ resolve: resolver(table), transport })(url), code);
    expect(sent).toEqual([]);
  };

  it.each([
    ["http://myproduct.example/", "insecure_scheme"],
    ["ftp://myproduct.example/", "insecure_scheme"],
    ["https://user:pass@myproduct.example/", "credentials_in_url"],
    ["https://myproduct.example:8443/", "non_default_port"],
    ["not a url", "invalid_url"],
    ["", "invalid_url"],
  ])("refuses %s (%s)", async (url, code) => {
    await nothingSent(url, code);
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
    "https://0x7f.1/",
    "https://2130706433/",
  ])("refuses the private address %s", async (url) => {
    await nothingSent(url, "private_address");
  });

  it("refuses a hostname whose resolver returns a private address", async () => {
    await nothingSent("https://internal.myproduct.example/", "private_address", {
      "internal.myproduct.example": [{ address: "10.0.0.5", family: 4 }],
    });
  });

  it("refuses a hostname that resolves to one public and one private address", async () => {
    await nothingSent("https://mixed.myproduct.example/", "private_address", {
      "mixed.myproduct.example": [
        { address: "93.184.215.14", family: 4 },
        { address: "::1", family: 6 },
      ],
    });
  });

  it("refuses a hostname that does not resolve", async () => {
    await nothingSent("https://gone.myproduct.example/", "dns_failed", {
      "gone.myproduct.example": [],
    });
  });
});

/** The planted list from docs/TASKS.md M2 (fetchOwnSite). */
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
];

describe("fetchOwnSite: platform hosts (docs/PLAN.md 2.1.10)", () => {
  it.each(PLATFORM_URLS)("refuses %s as the first URL, before resolving it", async (url) => {
    const looked: string[] = [];
    const { transport, sent } = fakeTransport({});
    const fetchSite = createFetchOwnSite({
      resolve: async (host) => {
        looked.push(host);
        return PUBLIC;
      },
      transport,
    });
    await refused(fetchSite(url), "platform_host");
    expect(looked).toEqual([]);
    expect(sent).toEqual([]);
  });

  it.each(PLATFORM_URLS)("refuses %s as a redirect target", async (url) => {
    const { transport, sent } = fakeTransport({
      "https://myproduct.example/": { status: 302, headers: { location: url } },
    });
    await refused(
      createFetchOwnSite({ resolve: resolver(), transport })("https://myproduct.example/"),
      "platform_host",
    );
    expect(sent).toEqual(["https://myproduct.example/"]);
  });
});

describe("fetchOwnSite: redirects and responses", () => {
  it("refuses a redirect to another domain", async () => {
    const { transport, sent } = fakeTransport({
      "https://myproduct.example/": {
        status: 301,
        headers: { location: "https://elsewhere.example/" },
      },
    });
    await refused(
      createFetchOwnSite({ resolve: resolver(), transport })("https://myproduct.example/"),
      "redirect_off_site",
    );
    expect(sent).toEqual(["https://myproduct.example/"]);
  });

  it("refuses a redirect to http or to a private address on the same host", async () => {
    const http = fakeTransport({
      "https://myproduct.example/": {
        status: 301,
        headers: { location: "http://myproduct.example/" },
      },
    });
    await refused(
      createFetchOwnSite({ resolve: resolver(), transport: http.transport })(
        "https://myproduct.example/",
      ),
      "insecure_scheme",
    );
    // DNS rebinding: the same name resolves to a private address on the second hop.
    let calls = 0;
    const rebind = fakeTransport({
      "https://myproduct.example/": { status: 302, headers: { location: "/next" } },
    });
    await refused(
      createFetchOwnSite({
        resolve: async () => (++calls === 1 ? PUBLIC : [{ address: "169.254.169.254", family: 4 }]),
        transport: rebind.transport,
      })("https://myproduct.example/"),
      "private_address",
    );
    expect(rebind.sent).toEqual(["https://myproduct.example/"]);
  });

  it("stops after 3 redirects", async () => {
    const { transport } = fakeTransport({
      "https://myproduct.example/": { status: 302, headers: { location: "/1" } },
      "https://myproduct.example/1": { status: 302, headers: { location: "/2" } },
      "https://myproduct.example/2": { status: 302, headers: { location: "/3" } },
      "https://myproduct.example/3": { status: 302, headers: { location: "/4" } },
    });
    await refused(
      createFetchOwnSite({ resolve: resolver(), transport })("https://myproduct.example/"),
      "too_many_redirects",
    );
  });

  it.each(["application/json", "image/png", "application/pdf", "text/htmlx"])(
    "refuses a %s response",
    async (type) => {
      const { transport } = fakeTransport({
        "https://myproduct.example/": { headers: { "content-type": type } },
      });
      await refused(
        createFetchOwnSite({ resolve: resolver(), transport })("https://myproduct.example/"),
        "not_html",
      );
    },
  );

  it("refuses a response with no content type", async () => {
    const { transport } = fakeTransport({
      "https://myproduct.example/": { headers: { "content-type": "" } },
    });
    await refused(
      createFetchOwnSite({ resolve: resolver(), transport })("https://myproduct.example/"),
      "not_html",
    );
  });

  it("refuses a 3 MB body that declares its length", async () => {
    const { transport } = fakeTransport({
      "https://myproduct.example/": { headers: { "content-length": String(3 * 1024 * 1024) } },
    });
    await refused(
      createFetchOwnSite({ resolve: resolver(), transport })("https://myproduct.example/"),
      "too_large",
    );
  });

  it("refuses a 3 MB body streamed without a length", async () => {
    const chunk = new Uint8Array(512 * 1024).fill(97);
    const { transport } = fakeTransport({
      "https://myproduct.example/": { body: Array.from({ length: 6 }, () => chunk) },
    });
    await refused(
      createFetchOwnSite({ resolve: resolver(), transport })("https://myproduct.example/"),
      "too_large",
    );
  });

  it("refuses an error status", async () => {
    const { transport } = fakeTransport({ "https://myproduct.example/": { status: 404 } });
    await refused(
      createFetchOwnSite({ resolve: resolver(), transport })("https://myproduct.example/"),
      "http_status",
    );
  });

  it("gives up after the timeout", async () => {
    const { transport } = fakeTransport({ "https://myproduct.example/": { status: -1 } });
    await refused(
      createFetchOwnSite({ resolve: resolver(), transport, timeoutMs: 50 })(
        "https://myproduct.example/",
      ),
      "timeout",
    );
  });
});

describe("fetchOwnSite with the real node:https transport", () => {
  it("refuses a name that resolves to loopback inside the connection's own lookup, before connecting", async () => {
    const fetchSite = createFetchOwnSite({
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    await refused(fetchSite("https://myproduct.example/"), "private_address");
  });

  it("refuses localhost through the system resolver", async () => {
    await refused(fetchOwnSite("https://localhost/"), "private_address");
  });
});
