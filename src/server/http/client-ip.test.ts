import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

describe("clientIp", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry, else one shared bucket", () => {
    expect(
      clientIp(new Headers({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.1" })),
    ).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe(
      "198.51.100.1",
    );
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
