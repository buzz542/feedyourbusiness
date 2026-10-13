import { describe, expect, it, vi } from "vitest";
import { SafeFetchError, assertAllowedUrl, createSafeFetch } from "./safe-fetch";

const ALLOWED = ["api.example.test"];

function makeFetch(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn<typeof globalThis.fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("fetchImpl called more times than expected");
    return next;
  });
}

const ok = () => new Response("ok", { status: 200 });
const redirect = (to: string, status = 302) =>
  new Response(null, { status, headers: { location: to } });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SafeFetchError) return error.code;
    throw error;
  }
  return "no_error";
}

describe("safeFetch: host allowlist", () => {
  it("calls an allowlisted https host exactly once, with manual redirects and a timeout signal", async () => {
    const fetchImpl = makeFetch(ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    const response = await safeFetch("https://api.example.test/v1/search?q=x");

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("blocks a host that is not on the allowlist and never touches the network", async () => {
    const fetchImpl = makeFetch(ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    expect(await codeOf(safeFetch("https://evil.example/"))).toBe("host_not_allowed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks everything when the allowlist is empty", async () => {
    const fetchImpl = makeFetch(ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => [], fetchImpl });

    expect(await codeOf(safeFetch("https://api.example.test/"))).toBe("host_not_allowed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["suffix lookalike", "https://api.example.test.evil.com/"],
    ["prefix lookalike", "https://evil-api.example.test/"],
    ["subdomain of an allowed host", "https://sub.api.example.test/"],
    ["allowed host only in the path", "https://evil.com/api.example.test"],
    ["allowed host only in the query", "https://evil.com/?h=api.example.test"],
    ["localhost", "https://localhost/"],
    ["loopback IPv4", "https://127.0.0.1/"],
    ["cloud metadata IP", "https://169.254.169.254/latest/meta-data/"],
    ["IPv6 loopback", "https://[::1]/"],
    ["decimal-encoded loopback", "https://2130706433/"],
    ["private range", "https://10.0.0.5/"],
  ])("blocks %s", async (_label, url) => {
    const fetchImpl = makeFetch(ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    expect(await codeOf(safeFetch(url))).toBe("host_not_allowed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks the userinfo trick that makes an allowed host look like a username", async () => {
    const fetchImpl = makeFetch(ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    expect(await codeOf(safeFetch("https://api.example.test@evil.com/"))).toBe(
      "credentials_in_url",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("matches hosts case-insensitively and ignores a trailing dot", () => {
    expect(assertAllowedUrl("https://API.Example.TEST/", ALLOWED).hostname).toBe(
      "api.example.test",
    );
    expect(assertAllowedUrl("https://api.example.test./", ALLOWED).hostname).toBe(
      "api.example.test.",
    );
  });
});

describe("safeFetch: scheme, port and malformed input", () => {
  it.each([
    ["http", "http://api.example.test/", "insecure_scheme"],
    ["ftp", "ftp://api.example.test/", "insecure_scheme"],
    ["file", "file:///etc/passwd", "insecure_scheme"],
    ["non-default port", "https://api.example.test:8443/", "non_default_port"],
    ["credentials", "https://user:pass@api.example.test/", "credentials_in_url"],
    ["garbage", "not a url", "invalid_url"],
    ["empty", "", "invalid_url"],
  ])("rejects %s", async (_label, url, code) => {
    const fetchImpl = makeFetch(ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    expect(await codeOf(safeFetch(url))).toBe(code);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows the explicit default https port", async () => {
    const fetchImpl = makeFetch(ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    await expect(safeFetch("https://api.example.test:443/")).resolves.toBeInstanceOf(Response);
  });
});

describe("safeFetch: redirects are re-checked on every hop", () => {
  it("follows a redirect that stays on the allowlist", async () => {
    const fetchImpl = makeFetch(redirect("/v2/search"), ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    const response = await safeFetch("https://api.example.test/v1/search");

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe("https://api.example.test/v2/search");
  });

  it("stops a redirect to a host off the allowlist before requesting it", async () => {
    const fetchImpl = makeFetch(redirect("https://evil.example/steal"), ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    expect(await codeOf(safeFetch("https://api.example.test/"))).toBe("host_not_allowed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops a redirect downgrade to http", async () => {
    const fetchImpl = makeFetch(redirect("http://api.example.test/"), ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    expect(await codeOf(safeFetch("https://api.example.test/"))).toBe("insecure_scheme");
  });

  it("gives up after three redirects", async () => {
    const fetchImpl = makeFetch(
      redirect("/a"),
      redirect("/b"),
      redirect("/c"),
      redirect("/d"),
      ok(),
    );
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    expect(await codeOf(safeFetch("https://api.example.test/"))).toBe("too_many_redirects");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("refuses to follow redirects for non-GET requests", async () => {
    const fetchImpl = makeFetch(redirect("/elsewhere", 307), ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    expect(
      await codeOf(safeFetch("https://api.example.test/", { method: "POST", body: "{}" })),
    ).toBe("redirect_on_unsafe_method");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns a 3xx without a Location header as is", async () => {
    const fetchImpl = makeFetch(new Response(null, { status: 304 }));
    const safeFetch = createSafeFetch({ getAllowedHosts: () => ALLOWED, fetchImpl });

    expect((await safeFetch("https://api.example.test/")).status).toBe(304);
  });
});

describe("safeFetch: kill switches", () => {
  it("re-reads the allowlist on every call, so pausing a source takes effect at once", async () => {
    let hosts: string[] = ["api.example.test"];
    const fetchImpl = makeFetch(ok(), ok());
    const safeFetch = createSafeFetch({ getAllowedHosts: () => hosts, fetchImpl });

    await safeFetch("https://api.example.test/");
    hosts = [];

    expect(await codeOf(safeFetch("https://api.example.test/"))).toBe("host_not_allowed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
