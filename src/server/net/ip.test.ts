import { describe, expect, it } from "vitest";
import { isPublicAddress } from "./ip";

/** Which resolved addresses fetchOwnSite may connect to (docs/PLAN.md 12.3). */
describe("isPublicAddress", () => {
  it.each([
    "93.184.215.14",
    "1.1.1.1",
    "8.8.8.8",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "2a00:1450:4009:81f::200e",
  ])("allows the public address %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    ["this network", "0.0.0.0"],
    ["loopback", "127.0.0.1"],
    ["loopback, high", "127.255.255.254"],
    ["private 10/8", "10.0.0.1"],
    ["private 172.16/12", "172.16.0.1"],
    ["private 172.16/12, top", "172.31.255.255"],
    ["private 192.168/16", "192.168.1.1"],
    ["link-local and cloud metadata", "169.254.169.254"],
    ["CGNAT", "100.64.0.1"],
    ["CGNAT, top", "100.127.255.255"],
    ["IETF protocol assignments", "192.0.0.8"],
    ["documentation", "192.0.2.10"],
    ["documentation 2", "198.51.100.1"],
    ["documentation 3", "203.0.113.5"],
    ["benchmarking", "198.18.0.1"],
    ["6to4 relay anycast", "192.88.99.1"],
    ["multicast", "224.0.0.1"],
    ["reserved", "240.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 unspecified", "::"],
    ["IPv6 loopback", "::1"],
    ["IPv6 loopback, long form", "0:0:0:0:0:0:0:1"],
    ["IPv6 unique local", "fc00::1"],
    ["IPv6 unique local fd", "fd12:3456:789a::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 link-local with zone", "fe80::1%eth0"],
    ["IPv6 multicast", "ff02::1"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped private, hex form", "::ffff:a00:1"],
    ["IPv4-mapped metadata", "::ffff:169.254.169.254"],
    ["IPv4-compatible (deprecated)", "::127.0.0.1"],
    ["NAT64", "64:ff9b::7f00:1"],
    ["6to4", "2002:7f00:1::1"],
    ["Teredo", "2001:0:4136:e378::1"],
    ["IPv6 documentation", "2001:db8::1"],
    ["IPv6 documentation 2", "3fff::1"],
    ["discard prefix", "100::1"],
  ])("refuses %s (%s)", (_label, ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    "",
    "not-an-ip",
    "256.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "01.2.3.4",
    "1::2::3",
    "gggg::1",
    "[::1]",
  ])("refuses the malformed address %j rather than guessing", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it("allows a mapped public IPv4 address", () => {
    expect(isPublicAddress("::ffff:93.184.215.14")).toBe(true);
  });
});
