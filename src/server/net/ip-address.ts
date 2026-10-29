/**
 * Which IP addresses fetchOwnSite() may connect to (docs/PLAN.md 12.3).
 *
 * Only globally reachable unicast addresses. Loopback, private, link-local, CGNAT, multicast,
 * documentation, benchmarking and reserved ranges are refused, in IPv4 and IPv6, including IPv4
 * addresses wrapped in IPv6 (mapped, compatible, NAT64, 6to4). Anything that does not parse is
 * refused. Pure functions: `node:net` is off limits outside the network wrapper files.
 */

/** Refused IPv4 blocks as [base address, prefix length]. */
const IPV4_BLOCKED: readonly (readonly [number, number])[] = [
  [ipv4("0.0.0.0"), 8], // "this network"
  [ipv4("10.0.0.0"), 8], // private
  [ipv4("100.64.0.0"), 10], // CGNAT
  [ipv4("127.0.0.0"), 8], // loopback
  [ipv4("169.254.0.0"), 16], // link-local, cloud metadata
  [ipv4("172.16.0.0"), 12], // private
  [ipv4("192.0.0.0"), 24], // IETF protocol assignments
  [ipv4("192.0.2.0"), 24], // documentation
  [ipv4("192.88.99.0"), 24], // 6to4 relay anycast
  [ipv4("192.168.0.0"), 16], // private
  [ipv4("198.18.0.0"), 15], // benchmarking
  [ipv4("198.51.100.0"), 24], // documentation
  [ipv4("203.0.113.0"), 24], // documentation
  [ipv4("224.0.0.0"), 4], // multicast
  [ipv4("240.0.0.0"), 4], // reserved, broadcast
];

function ipv4(text: string): number {
  const parsed = parseIPv4(text);
  if (parsed === null) throw new Error("bad constant");
  return parsed;
}

/** Strict dotted quad, decimal, no leading zeros. Returns the unsigned 32-bit value. */
function parseIPv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** Eight 16-bit groups, or null. Accepts `::` and a trailing dotted IPv4 part. */
function parseIPv6(text: string): number[] | null {
  let rest = text;
  let tail: [number, number] | null = null;
  if (rest.includes(".")) {
    // A trailing dotted IPv4 part stands for the last two groups.
    const lastColon = rest.lastIndexOf(":");
    const v4 = parseIPv4(rest.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    rest = rest.slice(0, lastColon + 1) + "0:0";
  }
  const halves = rest.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
    return groups.map((g) => parseInt(g, 16));
  };
  const head = toGroups(halves[0] ?? "");
  const end = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (head === null || end === null) return null;
  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - end.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<number>(missing).fill(0), ...end];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail) groups.splice(6, 2, ...tail);
  return groups;
}

function isPublicIPv4(value: number): boolean {
  return !IPV4_BLOCKED.some(([base, prefix]) => {
    const size = 2 ** (32 - prefix);
    return value >= base && value < base + size;
  });
}

const embeddedIPv4 = (g: readonly number[]): number => (g[6] ?? 0) * 65536 + (g[7] ?? 0);

function isPublicIPv6(g: readonly number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0] = g;
  const firstSixZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // ::ffff:a.b.c.d reaches the IPv4 address itself.
  if (firstSixZero && g5 === 0xffff) return isPublicIPv4(embeddedIPv4(g));
  // NAT64 well-known prefix 64:ff9b::/96 also reaches the embedded IPv4 address.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPublicIPv4(embeddedIPv4(g));
  }
  // Global unicast is 2000::/3. Everything outside it (::, ::1, IPv4-compatible, fc00::/7,
  // fe80::/10, ff00::/8, 100::/64, 64:ff9b:1::/48 and the rest) is refused.
  if (g0 < 0x2000 || g0 > 0x3fff) return false;
  if (g0 === 0x2001 && g1 < 0x0200) return false; // 2001::/23 IETF assignments, Teredo
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  if (g0 === 0x2002) return false; // 6to4
  if (g0 === 0x3fff && g1 < 0x1000) return false; // documentation (3fff::/20)
  return true;
}

/** True only for a globally reachable unicast address. Brackets and an IPv6 zone are tolerated. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[(.*)\]$/, "$1");
  if (bare.includes("%")) return false; // a zone id means link-local scope
  const v4 = parseIPv4(bare);
  if (v4 !== null) return isPublicIPv4(v4);
  if (!bare.includes(":")) return false;
  const v6 = parseIPv6(bare);
  return v6 !== null && isPublicIPv6(v6);
}

/** True when a URL hostname (as `new URL().hostname` gives it) is an IP address, not a name. */
export function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith("[") || parseIPv4(hostname) !== null;
}
