import { describe, expect, it } from "vitest";
import { isIpLiteral, isPublicAddress } from "./ip-address";

describe("isPublicAddress", () => {
  it.each([
    "93.184.215.14",
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255",
    "172.32.0.0",
    "100.63.255.255",
    "100.128.0.0",
    "169.253.255.255",
    "2606:4700:4700::1111",
    "2a00:1450:4009:81f::200e",
    // An IPv4-mapped or NAT64 form of a public IPv4 address reaches that public address.
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
  ])("allows the public address %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    // The addresses the plan names (docs/TASKS.md, M2).
    "127.0.0.1",
    "::1",
    "169.254.169.254",
    "10.0.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "fc00::1",
    "::ffff:127.0.0.1",
    // The rest of the special-purpose ranges.
    "0.0.0.0",
    "0.1.2.3",
    "127.255.255.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "fd12:3456:789a::1",
    "2001:db8::1",
    "2001::1",
    "2001:10::1",
    "2002:7f00:1::1",
    "3fff::1",
    "100::1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:a9fe:a9fe",
    "::127.0.0.1",
    "64:ff9b::a00:1",
    "64:ff9b:1::1",
    "[::1]",
  ])("refuses the non-public address %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(["", "not-an-ip", "1.2.3", "1.2.3.256", "01.2.3.4", "1.2.3.4.5", "1::2::3", "12345::1"])(
    "refuses %j, which is not an address",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(false);
    },
  );
});

describe("isIpLiteral", () => {
  it.each(["127.0.0.1", "8.8.8.8", "[::1]", "[2606:4700:4700::1111]"])("%s is", (host) => {
    expect(isIpLiteral(host)).toBe(true);
  });

  it.each(["acme.example", "1.2.3.example", "localhost", "xn--80ak6aa92e.com"])(
    "%s is not",
    (host) => {
      expect(isIpLiteral(host)).toBe(false);
    },
  );
});
