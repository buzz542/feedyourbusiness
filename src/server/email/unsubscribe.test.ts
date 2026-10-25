import { describe, expect, it, vi } from "vitest";
import {
  createUnsubscribeHandler,
  signUnsubscribe,
  unsubscribeHeaders,
  verifyUnsubscribe,
} from "./unsubscribe";

const SECRET = "s".repeat(40);
const USER = "11111111-1111-4111-8111-111111111111";

describe("unsubscribe tokens", () => {
  it("verify for the user and list they were made for", () => {
    const token = signUnsubscribe(SECRET, USER, "daily");
    expect(verifyUnsubscribe(SECRET, token)).toEqual({ userId: USER, list: "daily" });
  });

  it("expire with the secret: a new secret refuses old tokens", () => {
    const token = signUnsubscribe(SECRET, USER, "daily");
    expect(verifyUnsubscribe("t".repeat(40), token)).toBeNull();
  });

  it("cannot be moved to another list or user", () => {
    const token = signUnsubscribe(SECRET, USER, "daily");
    const [, , sig] = token.split(".");
    expect(verifyUnsubscribe(SECRET, `${USER}.weekly.${sig}`)).toBeNull();
    expect(
      verifyUnsubscribe(SECRET, `22222222-2222-4222-8222-222222222222.daily.${sig}`),
    ).toBeNull();
  });

  it.each([null, "", "x", `${USER}.daily`, `${USER}.daily.abc.def`, `not-a-uuid.daily.abc`])(
    "refuses %j",
    (token) => {
      expect(verifyUnsubscribe(SECRET, token)).toBeNull();
    },
  );

  it("refuses to sign or verify with a short or missing secret", () => {
    expect(() => signUnsubscribe("short", USER, "daily")).toThrow();
    expect(verifyUnsubscribe(undefined, signUnsubscribe(SECRET, USER, "daily"))).toBeNull();
  });

  it("builds RFC 8058 one-click headers", () => {
    expect(unsubscribeHeaders("https://a.test/api/unsubscribe?t=x")).toEqual({
      "List-Unsubscribe": "<https://a.test/api/unsubscribe?t=x>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

describe("/api/unsubscribe", () => {
  const token = signUnsubscribe(SECRET, USER, "daily");
  const url = `https://a.test/api/unsubscribe?t=${encodeURIComponent(token)}`;

  it("GET shows a confirm page and changes nothing", async () => {
    const apply = vi.fn(async () => undefined);
    const response = await createUnsubscribeHandler({ secret: SECRET, apply })(new Request(url));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<form method="post"');
    expect(apply).not.toHaveBeenCalled();
  });

  it("POST turns the list off (also the one-click body)", async () => {
    const apply = vi.fn(async () => undefined);
    const response = await createUnsubscribeHandler({ secret: SECRET, apply })(
      new Request(url, { method: "POST", body: "List-Unsubscribe=One-Click" }),
    );
    expect(response.status).toBe(200);
    expect(apply).toHaveBeenCalledWith(USER, "daily");
  });

  it("refuses a bad token without applying", async () => {
    const apply = vi.fn(async () => undefined);
    const response = await createUnsubscribeHandler({ secret: SECRET, apply })(
      new Request("https://a.test/api/unsubscribe?t=bad", { method: "POST" }),
    );
    expect(response.status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });
});
