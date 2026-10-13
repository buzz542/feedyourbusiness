import { describe, expect, it, vi } from "vitest";
import { isCronAuthorized } from "./cron";
import { guard, isSameOrigin, json, readBodyText } from "./respond";

const SECRET = "a-long-random-cron-secret";
const req = (headers: Record<string, string>) =>
  new Request("https://app.example.test/x", { headers });

describe("isCronAuthorized", () => {
  it("accepts the exact bearer token", () => {
    expect(isCronAuthorized(req({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true);
  });

  it.each([
    ["no header", {}],
    ["wrong token", { authorization: "Bearer another-long-random-secret" }],
    ["wrong scheme", { authorization: `Basic ${SECRET}` }],
    ["token without scheme", { authorization: SECRET }],
    ["prefix of the token", { authorization: `Bearer ${SECRET.slice(0, -1)}` }],
    ["token plus suffix", { authorization: `Bearer ${SECRET}x` }],
  ])("rejects %s", (_label, headers) => {
    expect(isCronAuthorized(req(headers), SECRET)).toBe(false);
  });

  it("stays closed when the secret is unset or too short, even for a matching header", () => {
    expect(isCronAuthorized(req({ authorization: "Bearer " }), undefined)).toBe(false);
    expect(isCronAuthorized(req({ authorization: "Bearer " }), "")).toBe(false);
    expect(isCronAuthorized(req({ authorization: "Bearer short" }), "short")).toBe(false);
  });
});

describe("isSameOrigin", () => {
  const site = "https://app.example.test";

  it("accepts Sec-Fetch-Site same-origin, or an Origin that matches the site", () => {
    expect(isSameOrigin(req({ "sec-fetch-site": "same-origin" }), site)).toBe(true);
    expect(isSameOrigin(req({ origin: "https://app.example.test" }), site)).toBe(true);
  });

  it.each([
    ["no headers", {}],
    ["cross-site", { "sec-fetch-site": "cross-site" }],
    ["different origin", { origin: "https://evil.example" }],
    ["same host, different scheme", { origin: "http://app.example.test" }],
    ["same host, different port", { origin: "https://app.example.test:8443" }],
    ["lookalike", { origin: "https://app.example.test.evil.example" }],
    ["opaque origin", { origin: "null" }],
  ])("rejects %s", (_label, headers) => {
    expect(isSameOrigin(req(headers), site)).toBe(false);
  });
});

describe("json", () => {
  it("sets the status, content type and no-store caching", async () => {
    const response = json(201, { ok: true });
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("guard", () => {
  it("passes a response through untouched", async () => {
    const response = await guard(async () => json(200, { ok: true }));
    expect(response.status).toBe(200);
  });

  it("turns a thrown error into a JSON 500 that leaks nothing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await guard(async () => {
      throw new Error("sk_live_super_secret_value");
    });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("sk_live");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("sk_live");
    spy.mockRestore();
  });
});

describe("readBodyText", () => {
  const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request("https://app.example.test/x", { method: "POST", headers, body });

  it("reads a normal body, including multi-byte characters", async () => {
    expect(await readBodyText(post('{"name":"Zoë 日本"}'))).toBe('{"name":"Zoë 日本"}');
  });

  it("returns an empty string when there is no body", async () => {
    expect(await readBodyText(new Request("https://app.example.test/x"))).toBe("");
  });

  it("returns null when content-length says it is too large, without reading", async () => {
    expect(await readBodyText(post("x", { "content-length": "2000" }), 1000)).toBeNull();
  });

  it("returns null when the stream grows past the limit with no content-length", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(600));
        controller.enqueue(new Uint8Array(600));
        controller.close();
      },
    });
    const request = new Request("https://app.example.test/x", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(await readBodyText(request, 1000)).toBeNull();
  });

  it("accepts a body exactly at the limit", async () => {
    expect(await readBodyText(post("x".repeat(1000)), 1000)).toHaveLength(1000);
  });
});
