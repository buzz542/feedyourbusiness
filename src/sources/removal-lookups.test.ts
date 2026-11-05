import { describe, expect, it } from "vitest";
import { createSourceFetch } from "@/server/net/source-fetch";
import { bluesky, resolveBlueskyHandle } from "./bluesky";
import { resolveXUsername, x } from "./x";
import type { CollectSource } from "./types";

/** The removal form's lookups (docs/PLAN.md 4.8): each on its own source's host, read-only. */

const UA = "AskedFor/1.0 (test)";

function recorder(respond: (url: string) => Response) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return respond(url);
  }) as typeof globalThis.fetch;
  return { calls, fetchImpl };
}

const on = (source: CollectSource) => ({ [`SOURCE_${source.id.toUpperCase()}_ENABLED`]: "true" });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("resolveBlueskyHandle", () => {
  it("asks bsky.social's resolveHandle and returns the DID", async () => {
    const r = recorder(() => json({ did: "did:plc:invented00example" }));
    const sourceFetch = createSourceFetch(bluesky as CollectSource, {
      env: on(bluesky as CollectSource),
      fetchImpl: r.fetchImpl,
    });
    expect(await resolveBlueskyHandle(sourceFetch, UA, "@Maker.bsky.social")).toBe(
      "did:plc:invented00example",
    );
    expect(r.calls[0]!.url).toBe(
      "https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=maker.bsky.social",
    );
  });

  it("returns null for a handle that does not resolve, and makes no call for a malformed one", async () => {
    const r = recorder(() => json({ error: "InvalidRequest" }, 400));
    const sourceFetch = createSourceFetch(bluesky as CollectSource, {
      env: on(bluesky as CollectSource),
      fetchImpl: r.fetchImpl,
    });
    expect(await resolveBlueskyHandle(sourceFetch, UA, "nobody.bsky.social")).toBeNull();
    expect(await resolveBlueskyHandle(sourceFetch, UA, "not a handle")).toBeNull();
    expect(r.calls).toHaveLength(1);
  });

  it("is refused while Bluesky is switched off", async () => {
    const r = recorder(() => json({ did: "did:plc:x" }));
    const sourceFetch = createSourceFetch(bluesky as CollectSource, {
      env: {},
      fetchImpl: r.fetchImpl,
    });
    await expect(resolveBlueskyHandle(sourceFetch, UA, "maker.bsky.social")).rejects.toThrow();
    expect(r.calls).toEqual([]);
  });
});

describe("resolveXUsername", () => {
  it("asks api.x.com for the user by username, with the bearer token", async () => {
    const r = recorder(() => json({ data: { id: "1234567890", name: "M", username: "maker" } }));
    const sourceFetch = createSourceFetch(x as CollectSource, {
      env: on(x as CollectSource),
      fetchImpl: r.fetchImpl,
    });
    expect(await resolveXUsername(sourceFetch, "token-1", UA, "@maker")).toBe("1234567890");
    expect(r.calls[0]!.url).toBe("https://api.x.com/2/users/by/username/maker");
    expect(r.calls[0]!.headers.authorization).toBe("Bearer token-1");
  });

  it("returns null when there is no such user", async () => {
    const r = recorder(() => json({ errors: [{ title: "Not Found Error" }] }));
    const sourceFetch = createSourceFetch(x as CollectSource, {
      env: on(x as CollectSource),
      fetchImpl: r.fetchImpl,
    });
    expect(await resolveXUsername(sourceFetch, "t", UA, "nobody")).toBeNull();
    expect(await resolveXUsername(sourceFetch, "t", UA, "has spaces")).toBeNull();
    expect(r.calls).toHaveLength(1);
  });
});
