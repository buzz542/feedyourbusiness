import { describe, expect, it } from "vitest";
import { sessionCookieOptions } from "./config";

describe("sessionCookieOptions", () => {
  it("keeps the session cookie away from page scripts and on https only in production", () => {
    expect(sessionCookieOptions({ NEXT_PUBLIC_SITE_URL: "https://askedfor.app" })).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("drops Secure on plain-http localhost, where browsers would refuse the cookie", () => {
    expect(sessionCookieOptions({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }).secure).toBe(
      false,
    );
    expect(sessionCookieOptions({}).httpOnly).toBe(true);
  });
});
