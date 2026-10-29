import "server-only";
import { promises as dns } from "node:dns";
import https from "node:https";
import type { Readable } from "node:stream";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { decodedPathAndQuery, isPlatformHost, mentionsPlatformHost } from "./platform-hosts";
import { isProfilePath, isThirdPartyHost, mentionsThirdPartyHost } from "./third-party-hosts";

/**
 * fetchOwnSite(): the one fetch that goes to a host the user gives us, their own product site
 * (docs/PLAN.md 12.3). It is the only file besides safeFetch() allowed to open connections, and
 * the hosts gate allows `node:https` and `node:dns` here and nowhere else.
 *
 *   * https on port 443 only, no credentials, no IP addresses as hosts, no single-label or local
 *     names.
 *   * Every platform domain and its subdomains are refused (2.1.10), and so is a host that wraps
 *     one and any URL whose path or query embeds another URL or names a platform (reader proxies,
 *     archives), so this never becomes a way to fetch a platform.
 *   * Stores, registries, code hosts, review sites and profile sites are refused too, and so is a
 *     profile path on any host: those are someone else's site, full of other people's names.
 *   * Every address the host resolves to must be public. The check runs before each request and
 *     again inside the connection's own DNS lookup, so a host that answers differently the second
 *     time (DNS rebinding) is still refused.
 *   * At most 3 redirects, each within the same host or its `www` twin, each checked as above.
 *   * 10 seconds in all, 2 MB of body, `text/html` or `text/plain` only, no cookies.
 *
 * Nothing it fetches is stored or logged. Errors carry a code and the host, never the body.
 * Only fetchOwnSite(), its factory, the error and pure helpers are exported; the transport,
 * resolver and lookup stay in this file, and the factory's limits can only be tightened.
 */

export type OwnSiteErrorCode =
  | "invalid_url"
  | "insecure_scheme"
  | "credentials_in_url"
  | "non_default_port"
  | "invalid_host"
  | "ip_literal"
  | "platform_host"
  | "third_party_host"
  | "profile_path"
  | "private_address"
  | "redirect_off_site"
  | "too_many_redirects"
  | "http_status"
  | "unsupported_type"
  | "too_large"
  | "timeout"
  | "network";

export class OwnSiteError extends Error {
  constructor(
    readonly code: OwnSiteErrorCode,
    readonly host: string,
    message: string,
    /** The HTTP status, for `http_status` only. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "OwnSiteError";
  }
}

export interface OwnSitePage {
  /** The final URL, after redirects. */
  url: string;
  contentType: "text/html" | "text/plain";
  body: string;
}

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolve = (host: string) => Promise<ResolvedAddress[]>;
type Lookup = NonNullable<https.RequestOptions["lookup"]>;

export interface TransportRequest {
  url: URL;
  lookup: Lookup;
  maxBytes: number;
  signal: AbortSignal;
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface OwnSiteFetchOptions {
  resolve?: Resolve;
  transport?: Transport;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const LOCAL_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa", ".intranet"];
export const OWN_SITE_USER_AGENT =
  "AskedFor/1.0 (+https://askedfor.app/bot; reads a product site a user pasted)";

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

function parseIPv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255) ? octets : null;
}

function isPublicIPv4([a, b, c]: number[]): boolean {
  if (a === undefined || b === undefined || c === undefined) return false;
  if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, documentation
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** Expand an IPv6 address to its eight 16-bit groups, or null if it is not one. */
function parseIPv6(address: string): number[] | null {
  if (address.includes("%")) return null; // zone ids are link-local by definition
  let text = address.toLowerCase();
  let tail: number[] = [];
  const v4 = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    const octets = parseIPv4(v4[2] ?? "");
    if (!octets) return null;
    tail = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    text = `${v4[1]}0:0`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0] ?? "");
  const rest = halves.length === 2 ? groups(halves[1] ?? "") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const parsed = all.map((g) => parseInt(g, 16));
  if (tail.length) parsed.splice(6, 2, ...tail);
  return parsed;
}

function isPublicIPv6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0] = g;
  // Only global unicast (2000::/3) can be public; that excludes ::, ::1, IPv4-mapped and
  // compatible forms, NAT64, unique-local, link-local, site-local and multicast at once.
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  if (g0 === 0x2001 && g1 < 0x0200) return false; // IETF protocol assignments, Teredo, ORCHID
  if (g0 === 0x2002) return false; // 6to4 wraps an IPv4 address that may be private
  if (g0 === 0x3fff && g1 < 0x1000) return false; // documentation (RFC 9637)
  return !(g0 === 0x2001 && g1 === 0x0002 && g2 === 0); // benchmarking
}

/** True only for an address on the public internet. Anything unparseable is not. */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(address);
  return v6 ? isPublicIPv6(v6) : false;
}

const isIpLiteral = (host: string): boolean =>
  parseIPv4(host) !== null || host.includes(":") || /^\d+$/.test(host);

// ---------------------------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------------------------

const normalizeHost = (host: string): string =>
  host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");

/** Parse and check one URL. Throws OwnSiteError; never touches the network. */
/** Longer URLs are refused: nothing real needs more, and checks stay cheap. */
export const MAX_OWN_SITE_URL = 2048;

export function checkOwnSiteUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OwnSiteError("invalid_url", "", "Not a valid URL");
  }
  if (url.href.length > MAX_OWN_SITE_URL) {
    throw new OwnSiteError("invalid_url", "", "The URL is too long");
  }
  const host = normalizeHost(url.hostname);
  if (url.protocol !== "https:") throw new OwnSiteError("insecure_scheme", host, "https only");
  if (url.username || url.password) {
    throw new OwnSiteError("credentials_in_url", host, "URLs with credentials are refused");
  }
  if (url.port && url.port !== "443") {
    throw new OwnSiteError("non_default_port", host, "Only the default https port is allowed");
  }
  if (isIpLiteral(host)) throw new OwnSiteError("ip_literal", host, "A site needs a host name");
  if (!host.includes(".") || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new OwnSiteError("invalid_host", host, "Not a public host name");
  }
  if (isPlatformHost(host) || mentionsPlatformHost(url)) {
    throw new OwnSiteError("platform_host", host, "Platform pages are never fetched");
  }
  if (EMBEDDED_URL.test(decodedPathAndQuery(url))) {
    throw new OwnSiteError("platform_host", host, "Links that wrap another page are never fetched");
  }
  if (isThirdPartyHost(host) || mentionsThirdPartyHost(url)) {
    throw new OwnSiteError("third_party_host", host, "Only the product's own site is fetched");
  }
  if (isProfilePath(url.pathname)) {
    throw new OwnSiteError("profile_path", host, "Profile pages are never fetched");
  }
  return url;
}

/** A path or query carrying another absolute URL: a reader proxy, an archive or a redirector. */
const EMBEDDED_URL = /https?:\/+|(^|[/?=&])\/\/[a-z0-9-]+\.[a-z]/i;

const bareHost = (host: string): string => normalizeHost(host).replace(/^www\./, "");

/** The same host, or its `www` twin. Nothing else counts as the same site. */
export function isSameSite(a: string, b: string): boolean {
  const x = normalizeHost(a);
  const y = normalizeHost(b);
  if (x === y) return true;
  return bareHost(x) === bareHost(y) && (x === `www.${y}` || y === `www.${x}`);
}

// ---------------------------------------------------------------------------------------------
// DNS
// ---------------------------------------------------------------------------------------------

/**
 * A resolver with its own short timeout. Unlike dns.lookup it does not tie up the libuv threadpool
 * on a name server that never answers, and it ignores /etc/hosts, which no public site needs.
 */
const resolver = new dns.Resolver({ timeout: 3_000, tries: 1 });

const systemResolve: Resolve = async (host) => {
  const [v4, v6] = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
  const addresses: ResolvedAddress[] = [
    ...(v4.status === "fulfilled"
      ? v4.value.map((address) => ({ address, family: 4 as const }))
      : []),
    ...(v6.status === "fulfilled"
      ? v6.value.map((address) => ({ address, family: 6 as const }))
      : []),
  ];
  if (addresses.length === 0) throw new Error("no address");
  return addresses;
};

async function resolvePublic(resolve: Resolve, host: string): Promise<ResolvedAddress[]> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new OwnSiteError("network", host, "The host did not resolve");
  }
  if (addresses.length === 0) throw new OwnSiteError("network", host, "The host did not resolve");
  if (addresses.some((a) => !isPublicAddress(a.address))) {
    throw new OwnSiteError("private_address", host, "The host resolves to a private address");
  }
  return addresses;
}

type LookupCallback = (
  error: Error | null,
  address?: string | ResolvedAddress[],
  family?: number,
) => void;

/**
 * What a node:https `lookup` hands back for checked addresses: the whole list when node asks for
 * `all` (Happy Eyeballs, the default in Node 22), else the first address and its family, filtered to
 * the family node asked for. Null when no address of that family is left.
 */
export function lookupAnswer(
  addresses: readonly ResolvedAddress[],
  options: { all?: boolean; family?: number | string },
): { all: ResolvedAddress[] } | { address: string; family: 4 | 6 } | null {
  const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
  const usable = wanted ? addresses.filter((a) => a.family === wanted) : [...addresses];
  if (usable.length === 0) return null;
  return options.all ? { all: usable } : { address: usable[0]!.address, family: usable[0]!.family };
}

/** A `lookup` for node:https that refuses any private answer at connect time. */
function guardedLookup(resolve: Resolve): Lookup {
  return ((
    hostname: string,
    options: { all?: boolean; family?: number | string },
    callback: LookupCallback,
  ) => {
    resolvePublic(resolve, hostname).then(
      (addresses) => {
        const answer = lookupAnswer(addresses, options);
        if (!answer) callback(new OwnSiteError("network", hostname, "No usable address"));
        else if ("all" in answer) callback(null, answer.all);
        else callback(null, answer.address, answer.family);
      },
      (error: unknown) =>
        callback(error instanceof Error ? error : new OwnSiteError("network", hostname, "DNS")),
    );
  }) as Lookup;
}

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

function decoderFor(encoding: string | undefined) {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "":
    case "identity":
      return null;
    case "gzip":
    case "x-gzip":
      return createGunzip();
    case "deflate":
      return createInflate();
    case "br":
      return createBrotliDecompress();
    default:
      return undefined;
  }
}

function charsetOf(contentType: string | undefined): string {
  const match = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? "");
  return match?.[1]?.toLowerCase() ?? "utf-8";
}

function decode(bytes: Buffer, contentType: string | undefined): string {
  try {
    return new TextDecoder(charsetOf(contentType)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * Read an open response body: refuse a declared or actual size over `maxBytes` (counted after
 * decompression, so a compression bomb stops at the cap), refuse unknown encodings, and decode the
 * charset. Takes a stream that is already open, so it is no way to reach a host.
 */
export async function readBody(
  body: Readable,
  headers: Record<string, string | undefined>,
  maxBytes: number,
  host: string,
): Promise<string> {
  const declared = Number(headers["content-length"] ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    body.destroy();
    throw new OwnSiteError("too_large", host, "The page is too large");
  }
  const decoder = decoderFor(headers["content-encoding"]);
  if (decoder === undefined) {
    body.destroy();
    throw new OwnSiteError("unsupported_type", host, "Unknown content encoding");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > maxBytes)
        return done(new OwnSiteError("too_large", host, "The page is too large"));
      chunks.push(chunk);
      done();
    },
  });
  try {
    await (decoder ? pipeline(body, decoder, sink) : pipeline(body, sink));
  } catch (error) {
    throw error instanceof OwnSiteError
      ? error
      : new OwnSiteError("network", host, "The page could not be read");
  }
  return decode(Buffer.concat(chunks), headers["content-type"]);
}

const isReadableType = (contentType: string | undefined): boolean => {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
  return type === "text/html" || type === "text/plain";
};

/** The real transport: node:https with the guarded lookup, no agent reuse, no cookies. */
const httpsTransport: Transport = ({ url, lookup, maxBytes, signal }) =>
  new Promise<TransportResponse>((resolvePromise, reject) => {
    const host = normalizeHost(url.hostname);
    const request = https.request(
      url,
      {
        method: "GET",
        lookup,
        agent: false,
        signal,
        headers: {
          "user-agent": OWN_SITE_USER_AGENT,
          accept: "text/html, text/plain;q=0.9",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const headers: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(response.headers)) {
          headers[key] = Array.isArray(value) ? value.join(", ") : value;
        }
        // Redirects, errors and unreadable types are answered without reading the body.
        if (
          REDIRECTS.has(status) ||
          status < 200 ||
          status >= 300 ||
          !isReadableType(headers["content-type"])
        ) {
          response.destroy();
          resolvePromise({ status, headers, body: "" });
          return;
        }
        readBody(response, headers, maxBytes, host).then(
          (body) => resolvePromise({ status, headers, body }),
          reject,
        );
      },
    );
    request.on("error", (error) => reject(error));
    request.end();
  });

// ---------------------------------------------------------------------------------------------
// fetchOwnSite
// ---------------------------------------------------------------------------------------------

function asOwnSiteError(error: unknown, host: string, signal: AbortSignal): OwnSiteError {
  if (error instanceof OwnSiteError) return error;
  if (signal.aborted) return new OwnSiteError("timeout", host, "The site took too long");
  return new OwnSiteError("network", host, "The site could not be reached");
}

export function createOwnSiteFetch(options: OwnSiteFetchOptions = {}) {
  const resolve = options.resolve ?? systemResolve;
  const transport = options.transport ?? httpsTransport;
  // Tests may tighten the limits; nothing may loosen them past 12.3, and NaN counts as no change.
  const clamp = (value: number | undefined, max: number) =>
    value !== undefined && Number.isFinite(value) ? Math.max(0, Math.min(value, max)) : max;
  const timeoutMs = clamp(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxBytes = clamp(options.maxBytes, DEFAULT_MAX_BYTES);
  const maxRedirects = clamp(options.maxRedirects, DEFAULT_MAX_REDIRECTS);
  const lookup = guardedLookup(resolve);

  return async function fetchOwnSite(input: string | URL): Promise<OwnSitePage> {
    const first = checkOwnSiteUrl(input);
    const signal = AbortSignal.timeout(timeoutMs);
    const timedOut = new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () =>
        reject(new OwnSiteError("timeout", first.hostname, "The site took too long")),
      ),
    );
    // Raced below; this keeps a timeout that fires after the fetch finished from going unhandled.
    timedOut.catch(() => {});

    let url = first;
    for (let hop = 0; ; hop++) {
      const host = normalizeHost(url.hostname);
      let response: TransportResponse;
      try {
        await Promise.race([resolvePublic(resolve, host), timedOut]);
        response = await Promise.race([transport({ url, lookup, maxBytes, signal }), timedOut]);
      } catch (error) {
        throw asOwnSiteError(error, host, signal);
      }

      if (REDIRECTS.has(response.status) && response.headers.location) {
        if (hop >= maxRedirects) {
          throw new OwnSiteError("too_many_redirects", host, "Too many redirects");
        }
        let next: URL;
        try {
          next = new URL(response.headers.location, url);
        } catch {
          throw new OwnSiteError("invalid_url", host, "The redirect is not a valid URL");
        }
        next.hash = "";
        // Check the target first: a platform is named as such even when it is also off-site.
        const checked = checkOwnSiteUrl(next);
        if (!isSameSite(first.hostname, checked.hostname)) {
          throw new OwnSiteError("redirect_off_site", host, "The site redirects elsewhere");
        }
        url = checked;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new OwnSiteError(
          "http_status",
          host,
          `The site answered ${response.status}`,
          response.status,
        );
      }
      if (!isReadableType(response.headers["content-type"])) {
        throw new OwnSiteError("unsupported_type", host, "Not an HTML or text page");
      }
      const type = response.headers["content-type"]!.split(";")[0]!.trim().toLowerCase() as
        "text/html" | "text/plain";
      // The transport caps bytes on the wire; this caps what a fake or a decoder hands back.
      if (response.body.length > maxBytes) {
        throw new OwnSiteError("too_large", host, "The page is too large");
      }
      return { url: url.href, contentType: type, body: response.body };
    }
  };
}

/** The wired instance, with the system resolver and the real transport. */
export const fetchOwnSite = createOwnSiteFetch();
