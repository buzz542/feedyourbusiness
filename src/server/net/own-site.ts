import "server-only";
import dns from "node:dns";
import https from "node:https";
import { isIpLiteral, isPublicAddress, unbracket } from "./ip";
import { OwnSiteError } from "./own-site-error";
import { embedsPlatformUrl, isPlatformHost } from "./platform-hosts";

/**
 * fetchOwnSite (docs/PLAN.md 12.3): fetch the user's own product page once, for the onboarding
 * draft. Besides safeFetch(), this is the only code allowed to open connections (the hosts gate
 * allows node:https and node:dns in this file only).
 *
 * - https on port 443 only, no credentials in the URL, no cookies or credentials sent.
 * - Every connection, redirects included, resolves the host through a lookup that refuses loopback,
 *   private, link-local, CGNAT, multicast and reserved addresses (IPv4 and IPv6, mapped forms too),
 *   so there is no DNS-rebinding gap between the check and the connection.
 * - Platform hosts (isPlatformHost), and URLs that carry a platform URL in their path or query
 *   (readers, archives, proxies), are refused as the first URL and as any redirect target.
 * - At most 3 redirects, within the same host or its www twin. 10 seconds in total, DNS included
 *   (the resolver is cancelled on timeout). Body capped at 2 MB. text/html or text/plain only.
 */

export { OwnSiteError, type OwnSiteErrorCode } from "./own-site-error";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

type LookupCallback = (
  error: Error | null,
  address?: string | ResolvedAddress[],
  family?: number,
) => void;
export type LookupFn = (
  hostname: string,
  options: { all?: boolean },
  callback: LookupCallback,
) => void;

export interface TransportResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: AsyncIterable<Uint8Array>;
  /** Stop reading and close the connection. */
  cancel(): void;
}

export interface OwnSiteDeps {
  /** Every A and AAAA address of `hostname`. Stops when `signal` aborts. */
  resolve(hostname: string, signal: AbortSignal): Promise<ResolvedAddress[]>;
  transport(
    url: URL,
    options: { lookup: LookupFn; signal: AbortSignal; headers: Record<string, string> },
  ): Promise<TransportResponse>;
  /** The overall budget. Tests shorten it; production uses 10 seconds. */
  timeoutMs?: number;
}

export interface OwnSitePage {
  /** The final URL, after redirects. */
  url: string;
  contentType: "text/html" | "text/plain";
  text: string;
}

const MAX_REDIRECTS = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const HEADERS = {
  "user-agent": "AskedFor/1.0 (+https://askedfor.app; reads the page you gave us, once)",
  accept: "text/html,text/plain;q=0.9",
  "accept-language": "en",
};

class PrivateAddressError extends Error {
  constructor() {
    super("Resolved to a private address");
    this.name = "PrivateAddressError";
  }
}

/** A lookup that refuses the connection when any resolved address is not public. */
function guardedLookup(resolve: OwnSiteDeps["resolve"], signal: AbortSignal): LookupFn {
  return (hostname, options, callback) => {
    resolve(hostname, signal).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
          callback(new PrivateAddressError());
          return;
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error("lookup failed")),
    );
  };
}

/**
 * The URL a user typed, as the https URL we store and fetch, or null. A missing scheme means https,
 * http is upgraded, and the fragment is dropped. The host must be a domain name.
 */
export function normalizeProductUrl(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  if (/^http:\/\//i.test(text)) text = `https://${text.slice(7)}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  // A domain name: dotted labels, the last one not a number (so no IPv4 literal).
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(url.hostname) || /\.\d+$/.test(url.hostname)) return null;
  url.hash = "";
  const out = url.href;
  return out.length <= 2048 ? out : null;
}

const wwwTwin = (a: string, b: string) => a === b || a === `www.${b}` || b === `www.${a}`;

/** Every check a URL must pass before we connect to it. */
function checkUrl(url: URL): void {
  if (url.protocol !== "https:") throw new OwnSiteError("insecure_scheme");
  if (url.username || url.password) throw new OwnSiteError("credentials_in_url");
  if (url.port && url.port !== "443") throw new OwnSiteError("non_default_port");
  const host = unbracket(url.hostname.toLowerCase());
  if (isPlatformHost(host)) throw new OwnSiteError("platform_host");
  if (isIpLiteral(host) && !isPublicAddress(host)) throw new OwnSiteError("private_address");
  if (embedsPlatformUrl(url)) throw new OwnSiteError("platform_host");
}

function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase();
}

function decode(bytes: Uint8Array, contentType: string | undefined): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readCapped(response: TransportResponse, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    response.cancel();
    throw new OwnSiteError("too_large");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    if (signal.aborted) {
      response.cancel();
      throw new OwnSiteError("timeout");
    }
    total += chunk.byteLength;
    if (total > MAX_BYTES) {
      response.cancel();
      throw new OwnSiteError("too_large");
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function toOwnSiteError(error: unknown, signal: AbortSignal): OwnSiteError {
  if (error instanceof OwnSiteError) return error;
  if (error instanceof PrivateAddressError) return new OwnSiteError("private_address");
  if (signal.aborted) return new OwnSiteError("timeout");
  return new OwnSiteError("network");
}

/** The budget a caller may ask for: shorter than 10 seconds for tests, never longer. */
export const budgetFor = (timeoutMs?: number): number =>
  Math.min(Math.max(1, timeoutMs ?? TIMEOUT_MS), TIMEOUT_MS);

/**
 * Fetch the user's page. `overrides` replaces single dependencies in tests; production passes
 * nothing, and the real resolver and transport are not exported, so nothing can use them to fetch
 * a URL without these checks.
 */
export async function fetchOwnSite(
  raw: string,
  overrides: Partial<OwnSiteDeps> = {},
): Promise<OwnSitePage> {
  const deps: OwnSiteDeps = { ...nodeDeps, ...overrides };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OwnSiteError("invalid_url");
  }
  // A product page needs neither, and a query is where proxies carry the URL they fetch.
  url.search = "";
  url.hash = "";
  checkUrl(url);
  const firstHost = url.hostname.toLowerCase();
  const signal = AbortSignal.timeout(budgetFor(deps.timeoutMs));
  const lookup = guardedLookup(deps.resolve, signal);

  try {
    for (let hop = 0; ; hop++) {
      const response = await deps.transport(url, { lookup, signal, headers: { ...HEADERS } });

      if (REDIRECTS.has(response.status)) {
        response.cancel();
        const location = response.headers.location;
        if (!location) throw new OwnSiteError("http_error");
        if (hop >= MAX_REDIRECTS) throw new OwnSiteError("too_many_redirects");
        const next = new URL(location, url);
        checkUrl(next);
        if (!wwwTwin(next.hostname.toLowerCase(), firstHost))
          throw new OwnSiteError("redirect_off_site");
        url = next;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        response.cancel();
        throw new OwnSiteError("http_error");
      }
      const type = mediaType(response.headers["content-type"]);
      if (type !== "text/html" && type !== "text/plain") {
        response.cancel();
        throw new OwnSiteError("unsupported_type");
      }
      const bytes = await readCapped(response, signal);
      return {
        url: url.href,
        contentType: type,
        text: decode(bytes, response.headers["content-type"]),
      };
    }
  } catch (error) {
    throw toOwnSiteError(error, signal);
  }
}

/** A name server that never answers must not hold the request for longer than this per query. */
const DNS_TIMEOUT_MS = 3_000;

/**
 * Real network access. Names resolve through a c-ares Resolver (not getaddrinfo, which blocks a
 * libuv thread and cannot be cancelled), cancelled when the request times out; connections use
 * node:https with the guarded lookup.
 */
const nodeDeps: OwnSiteDeps = {
  async resolve(hostname, signal) {
    if (signal.aborted) throw new Error("Aborted before resolving");
    const resolver = new dns.promises.Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
    const cancel = () => resolver.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const [v4, v6] = await Promise.allSettled([
        resolver.resolve4(hostname),
        resolver.resolve6(hostname),
      ]);
      const found: ResolvedAddress[] = [
        ...(v4.status === "fulfilled"
          ? v4.value.map((address) => ({ address, family: 4 as const }))
          : []),
        ...(v6.status === "fulfilled"
          ? v6.value.map((address) => ({ address, family: 6 as const }))
          : []),
      ];
      if (found.length === 0) throw new Error("No addresses");
      return found;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  },
  transport(url, { lookup, signal, headers }) {
    return new Promise((resolve, reject) => {
      const request = https.request(
        url,
        { method: "GET", headers, signal, agent: false, lookup: lookup as never },
        (res) => {
          const flat: Record<string, string | undefined> = {};
          for (const [key, value] of Object.entries(res.headers))
            flat[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
          resolve({
            status: res.statusCode ?? 0,
            headers: flat,
            body: res,
            cancel: () => res.destroy(),
          });
        },
      );
      request.on("error", reject);
      request.end();
    });
  },
};
