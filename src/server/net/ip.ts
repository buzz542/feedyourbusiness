/**
 * Is an IP address public? Used by fetchOwnSite() (docs/PLAN.md 12.3) to refuse loopback, private,
 * link-local, CGNAT, multicast, reserved, IPv6 unique-local and link-local addresses, and IPv4
 * addresses wrapped in IPv6 (mapped, NAT64, 6to4) that are any of those. Anything that does not
 * parse as an address is refused too.
 */

type Range = readonly [base: number, bits: number];

const V4_BLOCKED: readonly Range[] = [
  [v4(0, 0, 0, 0), 8], // this network
  [v4(10, 0, 0, 0), 8], // private
  [v4(100, 64, 0, 0), 10], // CGNAT
  [v4(127, 0, 0, 0), 8], // loopback
  [v4(169, 254, 0, 0), 16], // link-local (cloud metadata)
  [v4(172, 16, 0, 0), 12], // private
  [v4(192, 0, 0, 0), 24], // IETF protocol assignments
  [v4(192, 0, 2, 0), 24], // documentation
  [v4(192, 88, 99, 0), 24], // 6to4 relay anycast
  [v4(192, 168, 0, 0), 16], // private
  [v4(198, 18, 0, 0), 15], // benchmarking
  [v4(198, 51, 100, 0), 24], // documentation
  [v4(203, 0, 113, 0), 24], // documentation
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4], // reserved, broadcast
];

function v4(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function parseV4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^(0|[1-9]\d{0,2})$/.test(p) ? Number(p) : NaN));
  if (octets.some((o) => !(o >= 0 && o <= 255))) return null;
  return v4(octets[0]!, octets[1]!, octets[2]!, octets[3]!);
}

const inV4 = (ip: number, [base, bits]: Range) =>
  bits === 0 || ip >>> (32 - bits) === base >>> (32 - bits);

const isPublicV4 = (ip: number) => !V4_BLOCKED.some((range) => inV4(ip, range));

/** Eight 16-bit groups, or null. Accepts "::" compression and a trailing dotted IPv4. */
function parseV6(text: string): number[] | null {
  if (text.includes("%")) return null; // zone ids are link-local by definition
  let head = text;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  if (text.slice(lastColon + 1).includes(".")) {
    const embedded = parseV4(text.slice(lastColon + 1));
    if (embedded === null) return null;
    tail = [embedded >>> 16, embedded & 0xffff];
    head = text.slice(0, lastColon + 1);
    if (head.endsWith("::")) head = `${head}`;
    else head = head.slice(0, -1);
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const group = (g: string) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN);
  const left = halves[0] ? halves[0].split(":").map(group) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").map(group) : [];
  if ([...left, ...right].some(Number.isNaN)) return null;
  const known = left.length + right.length + tail.length;
  if (halves.length === 1) return known === 8 ? [...left, ...tail] : null;
  if (known > 7) return null;
  return [...left, ...new Array<number>(8 - known).fill(0), ...right, ...tail];
}

function isPublicV6(g: number[]): boolean {
  const [a, b, c, d, e, f, x, y] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const embedded = (hi: number, lo: number) => ((hi << 16) | lo) >>> 0;
  if (g.every((n) => n === 0)) return false; // ::
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0) {
    if (f === 0) return false; // ::1, ::/96 IPv4-compatible (deprecated): never public
    if (f === 0xffff) return isPublicV4(embedded(x, y)); // ::ffff:a.b.c.d mapped
    return false;
  }
  if (a === 0x64 && b === 0xff9b) {
    // NAT64: 64:ff9b::/96 well-known prefix carries an IPv4 address; 64:ff9b:1::/48 is local use.
    return c === 0 && d === 0 && e === 0 && f === 0 ? isPublicV4(embedded(x, y)) : false;
  }
  if (a === 0x2002) return isPublicV4(embedded(b, c)); // 6to4
  // Only global unicast (2000::/3) is public. That leaves out, among others, discard-only 100::/64,
  // unique local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8 and
  // every other reserved or unassigned range, including ::ffff:0:a.b.c.d (SIIT).
  if ((a & 0xe000) !== 0x2000) return false;
  if (a === 0x2001 && b < 0x200) return false; // 2001::/23 IETF protocol (Teredo and others)
  if (a === 0x2001 && b === 0xdb8) return false; // documentation
  if ((a & 0xfff0) === 0x3ff0) return false; // documentation 3fff::/20
  return true;
}

/** Strip the brackets URL hostnames put around IPv6 literals. */
export const unbracket = (host: string): string =>
  host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

/** True when `host` is an IP literal (v4 or v6), not a name. */
export function isIpLiteral(host: string): boolean {
  const bare = unbracket(host);
  return parseV4(bare) !== null || parseV6(bare) !== null;
}

export function isPublicAddress(address: string): boolean {
  const bare = unbracket(address.trim());
  const ip4 = parseV4(bare);
  if (ip4 !== null) return isPublicV4(ip4);
  const ip6 = parseV6(bare);
  return ip6 !== null && isPublicV6(ip6);
}
