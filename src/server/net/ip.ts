/**
 * Is an address one fetchOwnSite may connect to (docs/PLAN.md 12.3)? Only public unicast:
 * loopback, private, link-local (cloud metadata), CGNAT, multicast, reserved, documentation,
 * IPv6 unique-local and link-local, and IPv4 embedded in IPv6 in any form that hides one of those
 * are refused. Parsed by hand because node:net is not allowed outside safeFetch's gate exception,
 * and anything that does not parse is refused.
 */

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function parseIPv4(s: string): number[] | null {
  return IPV4.test(s) ? s.split(".").map(Number) : null;
}

/** [first address, prefix length] for each IPv4 range that is not public unicast. */
const IPV4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const toUint32 = (o: number[]) => ((o[0]! << 24) | (o[1]! << 16) | (o[2]! << 8) | o[3]!) >>> 0;

function isPublicIPv4(octets: number[]): boolean {
  const value = toUint32(octets);
  return IPV4_BLOCKED.every(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 !== (toUint32(parseIPv4(base)!) & mask) >>> 0;
  });
}

/** Eight 16-bit groups, or null. Accepts "::" and a trailing dotted IPv4. */
function parseIPv6(input: string): number[] | null {
  let s = input;
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!/^[0-9a-f:.]+$/i.test(s)) return null;

  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  if (s.includes(".")) {
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    // Keep the groups before the IPv4 part; a trailing "::" still means "zeros here".
    s = s.slice(0, lastColon + 1);
    if (!s.endsWith("::")) s = s.slice(0, -1);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const group = (part: string) => (part === "" ? [] : part.split(":"));
  const head = group(halves[0]!);
  const rest = halves.length === 2 ? group(halves[1]!) : [];
  if ([...head, ...rest].some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1 && known !== 8) return null;
  if (halves.length === 2 && known > 7) return null;
  const zeros = halves.length === 2 ? Array(8 - known).fill(0) : [];
  return [
    ...head.map((g) => parseInt(g, 16)),
    ...zeros,
    ...rest.map((g) => parseInt(g, 16)),
    ...tail,
  ];
}

function isPublicIPv6(g: number[]): boolean {
  const firstSixZero = g.slice(0, 6).every((x) => x === 0);
  // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d
  if (firstSixZero) return false;
  // IPv4-mapped ::ffff:a.b.c.d: judge the IPv4 address inside.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return isPublicIPv4([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff]);
  // Only global unicast 2000::/3 is public; this excludes fc00::/7, fe80::/10, ff00::/8, 100::/64.
  if ((g[0]! & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && g[1]! < 0x0200) return false; // Teredo, ORCHID, benchmarking and other IETF ranges
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2002) return false; // 6to4 carries an IPv4 address
  if (g[0] === 0x3fff && g[1]! < 0x1000) return false; // documentation (RFC 9637)
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPublicIPv4(v4);
  if (!ip.includes(":")) return false;
  const v6 = parseIPv6(ip);
  return v6 !== null && isPublicIPv6(v6);
}
