import { describe, expect, it, vi } from "vitest";
import { createPreviewHandler } from "./handler";
import type { PreviewDeps } from "./preview";

const SECRET = "s".repeat(40);
const NOW = new Date("2026-10-25T09:00:00Z");

const request = (body: string, ip = "203.0.113.9") =>
  new Request("https://askedfor.test/api/preview", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body,
  });

function store(countIp = 0) {
  return {
    countIp: vi.fn(async () => countIp),
    countAll: vi.fn(async () => 0),
    start: vi.fn(async () => "run"),
    finish: vi.fn(async () => {}),
  };
}

const depsWith = (s: ReturnType<typeof store>) =>
  ({ store: s, siteText: vi.fn() }) as unknown as PreviewDeps;

describe("POST /api/preview", () => {
  it("refuses a body that is not JSON", async () => {
    const handler = createPreviewHandler({ deps: () => null, secret: SECRET, clock: () => NOW });
    expect((await handler(request("not json"))).status).toBe(400);
  });

  it("is unavailable without a model key or an HMAC secret", async () => {
    const s = store();
    expect(
      (
        await createPreviewHandler({ deps: () => null, secret: SECRET })(
          request('{"url":"a.example"}'),
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await createPreviewHandler({ deps: () => depsWith(s), secret: "short" })(
          request('{"url":"a.example"}'),
        )
      ).status,
    ).toBe(503);
    expect(s.start).not.toHaveBeenCalled();
  });

  it("rate limits by a daily hash of the client IP, never the IP itself", async () => {
    const s = store(3);
    const res = await createPreviewHandler({
      deps: () => depsWith(s),
      secret: SECRET,
      clock: () => NOW,
    })(request('{"url":"invoicer.example"}'));
    expect(res.status).toBe(429);
    const [hash] = s.countIp.mock.calls[0] as unknown as [string];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203.0.113.9");
  });

  it("refuses a platform URL with a plain message", async () => {
    const s = store();
    const res = await createPreviewHandler({ deps: () => depsWith(s), secret: SECRET })(
      request('{"url":"https://www.reddit.com/r/SaaS"}'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Enter your own product's site, not a social media or forum link.",
    });
  });
});
