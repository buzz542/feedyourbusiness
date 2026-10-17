import { describe, expect, it, vi } from "vitest";
import {
  budgetFor,
  fetchOwnSite,
  normalizeProductUrl,
  OwnSiteError,
  type OwnSiteDeps,
  type TransportResponse,
} from "./own-site";

/** fetchOwnSite (docs/PLAN.md 12.3): the user's own page, once, with every SSRF door shut. */

const PUBLIC = [{ address: "93.184.216.34", family: 4 as const }];

function body(text: string): AsyncIterable<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return (async function* () {
    yield bytes;
  })();
}

function bigBody(bytes: number): AsyncIterable<Uint8Array> {
  return (async function* () {
    const chunk = new Uint8Array(64 * 1024).fill(97);
    for (let sent = 0; sent < bytes; sent += chunk.length) yield chunk;
  })();
}

type Script = Record<string, Partial<TransportResponse> & { status: number }>;

function deps(script: Script, resolve: OwnSiteDeps["resolve"] = async () => PUBLIC): OwnSiteDeps {
  return {
    resolve,
    // Like https.request: the connection asks the lookup for an address first.
    transport: vi.fn<OwnSiteDeps["transport"]>(
      (url, { lookup }) =>
        new Promise<TransportResponse>((done, fail) => {
          lookup(url.hostname, { all: true }, (error) => {
            if (error) return fail(error);
            const hit = script[url.href];
            if (!hit) return fail(new Error(`unscripted ${url.href}`));
            done({
              headers: { "content-type": "text/html; charset=utf-8" },
              body: body("<html><title>Invoicer</title></html>"),
              cancel: () => {},
              ...hit,
            });
          });
        }),
    ),
  };
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OwnSiteError);
    return (error as OwnSiteError).code;
  }
  throw new Error("expected a refusal");
};

describe("fetchOwnSite", () => {
  it("fetches an https page and returns its text and final URL", async () => {
    const d = deps({ "https://invoicer.example/": { status: 200 } });
    const page = await fetchOwnSite("https://invoicer.example/", d);
    expect(page).toEqual({
      url: "https://invoicer.example/",
      contentType: "text/html",
      text: "<html><title>Invoicer</title></html>",
    });
  });

  it("sends no cookies or credentials, and says who we are", async () => {
    const d = deps({ "https://invoicer.example/": { status: 200 } });
    await fetchOwnSite("https://invoicer.example/", d);
    const headers = vi.mocked(d.transport).mock.calls[0]![1].headers;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("cookie");
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");
    expect(headers["user-agent"]).toMatch(/AskedFor/);
  });

  it.each([
    ["http://", "http://invoicer.example/", "insecure_scheme"],
    ["a non-default port", "https://invoicer.example:8443/", "non_default_port"],
    ["credentials", "https://user:pass@invoicer.example/", "credentials_in_url"],
    ["127.0.0.1", "https://127.0.0.1/", "private_address"],
    ["::1", "https://[::1]/", "private_address"],
    ["169.254.169.254", "https://169.254.169.254/latest/meta-data/", "private_address"],
    ["10.0.0.1", "https://10.0.0.1/", "private_address"],
    ["192.168.1.1", "https://192.168.1.1/", "private_address"],
    ["100.64.0.1", "https://100.64.0.1/", "private_address"],
    ["fc00::1", "https://[fc00::1]/", "private_address"],
    ["::ffff:127.0.0.1", "https://[::ffff:127.0.0.1]/", "private_address"],
    ["a decimal IP", "https://2130706433/", "private_address"],
    ["not a URL", "not a url", "invalid_url"],
  ])("refuses %s", async (_label, url, expected) => {
    const d = deps({});
    expect(await code(fetchOwnSite(url, d))).toBe(expected);
    expect(d.transport).not.toHaveBeenCalled();
  });

  it("refuses a hostname whose resolver returns a private address", async () => {
    const d = deps({ "https://rebind.example/": { status: 200 } }, async () => [
      { address: "10.1.2.3", family: 4 },
    ]);
    expect(await code(fetchOwnSite("https://rebind.example/", d))).toBe("private_address");
  });

  it("refuses when any of several resolved addresses is private", async () => {
    const d = deps({ "https://mixed.example/": { status: 200 } }, async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "::1", family: 6 },
    ]);
    expect(await code(fetchOwnSite("https://mixed.example/", d))).toBe("private_address");
  });

  it("checks the address again on every redirect hop (no DNS-rebinding gap)", async () => {
    let calls = 0;
    const d = deps(
      {
        "https://invoicer.example/": {
          status: 301,
          headers: { location: "https://www.invoicer.example/" },
        },
        "https://www.invoicer.example/": { status: 200 },
      },
      async () => (++calls === 1 ? PUBLIC : [{ address: "127.0.0.1", family: 4 }]),
    );
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("private_address");
  });

  it("follows a same-host redirect and its www twin", async () => {
    const d = deps({
      "https://invoicer.example/": { status: 301, headers: { location: "/home" } },
      "https://invoicer.example/home": {
        status: 302,
        headers: { location: "https://www.invoicer.example/home" },
      },
      "https://www.invoicer.example/home": { status: 200 },
    });
    const page = await fetchOwnSite("https://invoicer.example/", d);
    expect(page.url).toBe("https://www.invoicer.example/home");
  });

  it("refuses a redirect to another domain", async () => {
    const d = deps({
      "https://invoicer.example/": {
        status: 302,
        headers: { location: "https://elsewhere.example/" },
      },
    });
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("redirect_off_site");
  });

  it("refuses a redirect to http or another port", async () => {
    const http = deps({
      "https://invoicer.example/": {
        status: 302,
        headers: { location: "http://invoicer.example/" },
      },
    });
    expect(await code(fetchOwnSite("https://invoicer.example/", http))).toBe("insecure_scheme");
    const port = deps({
      "https://invoicer.example/": {
        status: 302,
        headers: { location: "https://invoicer.example:444/" },
      },
    });
    expect(await code(fetchOwnSite("https://invoicer.example/", port))).toBe("non_default_port");
  });

  it("stops after 3 redirects", async () => {
    const d = deps({
      "https://invoicer.example/": { status: 302, headers: { location: "/a" } },
      "https://invoicer.example/a": { status: 302, headers: { location: "/b" } },
      "https://invoicer.example/b": { status: 302, headers: { location: "/c" } },
      "https://invoicer.example/c": { status: 302, headers: { location: "/d" } },
    });
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("too_many_redirects");
  });

  it("refuses a body over 2 MB (a 3 MB page)", async () => {
    const d = deps({
      "https://invoicer.example/": { status: 200, body: bigBody(3 * 1024 * 1024) },
    });
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("too_large");
  });

  it("refuses a declared length over 2 MB before reading", async () => {
    const cancel = vi.fn();
    const d = deps({
      "https://invoicer.example/": {
        status: 200,
        headers: { "content-type": "text/html", "content-length": String(3 * 1024 * 1024) },
        cancel,
      },
    });
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("too_large");
    expect(cancel).toHaveBeenCalled();
  });

  it.each(["application/pdf", "image/png", "application/json", "text/javascript", ""])(
    "refuses the type %j",
    async (type) => {
      const d = deps({
        "https://invoicer.example/": { status: 200, headers: { "content-type": type } },
      });
      expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("unsupported_type");
    },
  );

  it("accepts text/plain", async () => {
    const d = deps({
      "https://invoicer.example/": {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: body("plain"),
      },
    });
    expect((await fetchOwnSite("https://invoicer.example/", d)).contentType).toBe("text/plain");
  });

  it("refuses an error status", async () => {
    const d = deps({ "https://invoicer.example/": { status: 404 } });
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("http_error");
  });

  const PLANTED = [
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
    "https://archive.is/a1b2c",
    "https://r.jina.ai/https://www.reddit.com/r/x",
    "https://www.youtube-nocookie.com/embed/a",
    "https://www-reddit-com.cdn.ampproject.org/c/s/www.reddit.com/r/x",
    "https://new-reader.example/https://www.reddit.com/r/x",
    "https://reader.example/https://u@www.reddit.com/r/x",
    "https://reader.example/https:%5C%5Cwww.reddit.com%5Cr%5Cx",
    "https://reader.example/https://www%E3%80%82reddit%E3%80%82com/r/x",
    "https://reader.example/https://www.reddit.com%3Fa",
    "https://reader.example/www.reddit.com/r/x",
    "https://www.reddit.com.suffix-proxy.example/r/x",
    "https://hn-algolia-com.proxy.example/api/v1/search",
    "https://hacker--news-firebaseio-com.proxy.example/v0/item/1.json",
  ];

  it.each(PLANTED)("refuses the platform URL %s as the first URL", async (url) => {
    const d = deps({});
    expect(await code(fetchOwnSite(url, d))).toBe("platform_host");
    expect(d.transport).not.toHaveBeenCalled();
  });

  it.each(PLANTED)("refuses the platform URL %s as a redirect target", async (url) => {
    // The platform check runs before the same-site rule, so the refusal names the platform.
    const d = deps({
      "https://invoicer.example/": { status: 302, headers: { location: url } },
    });
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("platform_host");
  });

  it("refuses a same-site redirect that carries a platform URL", async () => {
    const d = deps({
      "https://invoicer.example/": {
        status: 302,
        headers: { location: "/go/https://www.reddit.com/r/x" },
      },
    });
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("platform_host");
  });

  it("refuses a platform host as a redirect even from its www twin", async () => {
    // A product site cannot be a platform, so the check runs before the same-site rule.
    const d = deps({
      "https://invoicer.example/": { status: 302, headers: { location: "https://reddit.com/" } },
    });
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("platform_host");
  });
});

describe("the first URL", () => {
  it("is fetched without its query or fragment, where proxies carry the URL they fetch", async () => {
    const d = deps({ "https://invoicer.example/pricing": { status: 200 } });
    const page = await fetchOwnSite(
      "https://invoicer.example/pricing?u=https://www.reddit.com/r/x#top",
      d,
    );
    expect(page.url).toBe("https://invoicer.example/pricing");
    expect(vi.mocked(d.transport).mock.calls[0]![0].href).toBe("https://invoicer.example/pricing");
  });

  it.each([
    "https://corsproxy.example/?https://www.reddit.com/r/x",
    "https://proxy.example/?url=www.reddit.com/r/x",
    "https://new-proxy.example/fetch?u=https%3A%2F%2Fx.com%2Fa",
  ])("still refuses a redirect that carries a platform URL in its query: %s", async (target) => {
    const d = deps({
      "https://invoicer.example/": {
        status: 302,
        headers: { location: target.replace(/^https:\/\/[^/]+/, "") },
      },
    });
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("platform_host");
  });
});

describe("the 10 second budget", () => {
  it("can be shortened by tests but never lengthened", () => {
    expect(budgetFor()).toBe(10_000);
    expect(budgetFor(50)).toBe(50);
    expect(budgetFor(60_000)).toBe(10_000);
    expect(budgetFor(0)).toBe(1);
  });

  /** A transport that honors the abort signal, like https.request does. */
  const slow = (response: "never" | "drip"): OwnSiteDeps => ({
    resolve: async () => PUBLIC,
    timeoutMs: 50,
    transport: (_url, { signal }) =>
      response === "never"
        ? new Promise((_done, fail) =>
            signal.addEventListener("abort", () => fail(signal.reason), { once: true }),
          )
        : Promise.resolve({
            status: 200,
            headers: { "content-type": "text/html" },
            body: (async function* () {
              for (;;) {
                await new Promise((wait) => setTimeout(wait, 10));
                yield new Uint8Array(16);
              }
            })(),
            cancel: () => {},
          }),
  });

  it("times out a server that never answers", async () => {
    expect(await code(fetchOwnSite("https://invoicer.example/", slow("never")))).toBe("timeout");
  });

  it("times out a body that drips in forever", async () => {
    expect(await code(fetchOwnSite("https://invoicer.example/", slow("drip")))).toBe("timeout");
  });

  it("passes the abort signal to the resolver", async () => {
    let seen: AbortSignal | undefined;
    const d: Partial<OwnSiteDeps> = {
      timeoutMs: 50,
      resolve: (_host, signal) => {
        seen = signal;
        return new Promise((_done, fail) =>
          signal.addEventListener("abort", () => fail(signal.reason), { once: true }),
        );
      },
    };
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("timeout");
    expect(seen?.aborted).toBe(true);
  });
});

describe("fetchOwnSite with the real resolver", () => {
  it("fails a name that cannot resolve, inside the budget", async () => {
    // .invalid never resolves (RFC 2606). Without DNS in the sandbox, the budget ends it instead.
    const started = Date.now();
    expect(["network", "timeout"]).toContain(
      await code(fetchOwnSite("https://askedfor-test.invalid/", { timeoutMs: 500 })),
    );
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("fetchOwnSite with the real transport", () => {
  it("connects only through the guarded lookup (a private answer stops the connection)", async () => {
    // Without the guarded lookup, https.request would ask the system resolver and fail as network.
    const d: Partial<OwnSiteDeps> = {
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    };
    expect(await code(fetchOwnSite("https://invoicer.example/", d))).toBe("private_address");
  });
});

describe("normalizeProductUrl", () => {
  it.each([
    ["invoicer.example", "https://invoicer.example/"],
    ["  https://Invoicer.example/pricing ", "https://invoicer.example/pricing"],
    ["http://invoicer.example", "https://invoicer.example/"],
    ["www.invoicer.example/a?b=c#top", "https://www.invoicer.example/a?b=c"],
  ])("%j becomes %j", (raw, expected) => {
    expect(normalizeProductUrl(raw)).toBe(expected);
  });

  it.each([
    "",
    "not a url",
    "ftp://x.example",
    "https://localhost",
    "https://",
    "mailto:a@b.c",
    "https://93.184.216.34/",
    "93.184.216.34",
  ])("refuses %j", (raw) => {
    expect(normalizeProductUrl(raw)).toBeNull();
  });
});
