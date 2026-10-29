import "server-only";
import dns from "node:dns";
import https from "node:https";
import { isIpLiteral, isPublicAddress } from "./ip-address";
import { isPlatformHost, namesPlatformDomain } from "./platform-hosts";
import { isProfilePath, isThirdPartyHost } from "./third-party-hosts";

/**
 * fetchOwnSite() (docs/PLAN.md 12.3): reads one page of the user's own site. Besides safeFetch(),
 * this is the only file allowed to open connections (`compliance:hosts`), and only with
 * `node:https` and `node:dns`.
 *
 * It refuses, before anything is fetched and again for every redirect: anything but https on port
 * 443, credentials in the URL, IP literals, platform hosts (`isPlatformHost()`), third-party hosts
 * (`isThirdPartyHost()`), a path or query naming a platform domain, and a profile path. The host is
 * resolved inside the connection itself through a custom `lookup`, which refuses any answer that is
 * not a public address, so a name that resolves to a public address for the check and a private
 * one for the connect (DNS rebinding) never gets through. At most 3 redirects within the same host
 * or its www twin, 10 seconds, 2 MB, `text/html` or `text/plain`, no cookies, no compression.
 *
 * Nothing it reads is stored or logged. Callers see an `OwnSiteError` code, never a body.
 */

export type OwnSiteErrorCode =
  | "invalid_url"
  | "insecure_scheme"
  | "credentials_in_url"
  | "non_default_port"
  | "ip_literal"
  | "blocked_address"
  | "platform_host"
  | "third_party_host"
  | "names_platform"
  | "profile_path"
  | "dns_failed"
  | "redirect_off_site"
  | "too_many_redirects"
  | "unsupported_type"
  | "unsupported_encoding"
  | "body_too_large"
  | "timeout"
  | "network_error";

/** Codes that mean "this is someone else's site", as opposed to "your site could not be read". */
export const NOT_OWN_SITE_CODES: ReadonlySet<OwnSiteErrorCode> = new Set([
  "platform_host",
  "third_party_host",
  "names_platform",
  "profile_path",
]);

export class OwnSiteError extends Error {
  constructor(
    readonly code: OwnSiteErrorCode,
    readonly host: string,
    message: string,
  ) {
    super(message);
    this.name = "OwnSiteError";
  }
}

export const OWN_SITE_MAX_BYTES = 2 * 1024 * 1024;
export const OWN_SITE_TIMEOUT_MS = 10_000;
/** The product token is what the site's robots.txt names to address us. */
export const OWN_SITE_USER_AGENT = "AskedFor/1.0 (+https://askedfor.app/sources)";

const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const READABLE_TYPES = new Set(["text/html", "text/plain"]);
const REQUEST_HEADERS: Readonly<Record<string, string>> = {
  "user-agent": OWN_SITE_USER_AGENT,
  accept: "text/html, text/plain;q=0.9",
  "accept-encoding": "identity",
  "accept-language": "en",
};

export interface OwnSiteResponse {
  /** The final status, after redirects. */
  status: number;
  /** The final URL, after redirects. */
  url: string;
  /** `text/html` or `text/plain` for a 2xx answer; null otherwise. */
  contentType: string | null;
  /** The decoded body of a 2xx answer; empty otherwise (a non-2xx body is never read). */
  text: string;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type OwnSiteResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | ResolvedAddress[],
  family?: number,
) => void;

/** The shape of the `lookup` option Node calls while connecting a socket. */
export type OwnSiteLookup = (
  hostname: string,
  options: { family?: number | string; all?: boolean },
  callback: LookupCallback,
) => void;

export interface OwnSiteTransportRequest {
  url: URL;
  headers: Readonly<Record<string, string>>;
  /** Must be the only way the connection resolves the host. */
  lookup: OwnSiteLookup;
  signal: AbortSignal;
}

export interface OwnSiteTransportResponse {
  status: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: AsyncIterable<Uint8Array>;
  /** Stop reading and close the connection. */
  close(): void;
}

/** One GET request. The real one is node:https; tests pass a fake that calls `lookup` too. */
export interface OwnSiteTransport {
  get(request: OwnSiteTransportRequest): Promise<OwnSiteTransportResponse>;
}

export interface CreateFetchOwnSiteOptions {
  resolve?: OwnSiteResolver;
  transport?: OwnSiteTransport;
  timeoutMs?: number;
}

const normalizeHost = (host: string): string => host.toLowerCase().replace(/\.$/, "");

/** Checks one URL against every rule that needs no network. Returns the parsed URL. */
export function checkOwnSiteUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new OwnSiteError("invalid_url", "", "Not a valid URL");
  }
  const host = normalizeHost(url.hostname);
  if (url.protocol !== "https:") {
    throw new OwnSiteError("insecure_scheme", host, "Only https URLs are read");
  }
  if (url.username || url.password) {
    throw new OwnSiteError("credentials_in_url", host, "URLs with credentials are not read");
  }
  if (url.port && url.port !== "443") {
    throw new OwnSiteError("non_default_port", host, "Only port 443 is read");
  }
  if (isIpLiteral(host)) {
    const code = isPublicAddress(host) ? "ip_literal" : "blocked_address";
    throw new OwnSiteError(code, host, "A site is read by its name, not an IP address");
  }
  if (!host.includes(".")) {
    throw new OwnSiteError("invalid_url", host, "Not a public site name");
  }
  if (isPlatformHost(host)) {
    throw new OwnSiteError("platform_host", host, "Platform sites are never fetched");
  }
  if (isThirdPartyHost(host)) {
    throw new OwnSiteError("third_party_host", host, "Third-party sites are never fetched");
  }
  if (namesPlatformDomain(url)) {
    throw new OwnSiteError("names_platform", host, "A URL that names a platform is never fetched");
  }
  if (isProfilePath(url.pathname)) {
    throw new OwnSiteError("profile_path", host, "Profile pages are never fetched");
  }
  return url;
}

const wantedFamily = (family: number | string | undefined): 4 | 6 | null =>
  family === 4 || family === "IPv4" ? 4 : family === 6 || family === "IPv6" ? 6 : null;

/**
 * The DNS lookup used for every connection: resolve, then refuse unless every answer is public.
 * Refusing on any private answer (not just the first) leaves the connect nothing private to pick.
 */
export function createOwnSiteLookup(resolve: OwnSiteResolver): OwnSiteLookup {
  return (hostname, options, callback) => {
    const host = normalizeHost(hostname);
    const dnsFailed = () => new OwnSiteError("dns_failed", host, "The site name did not resolve");
    resolve(host)
      .then(
        (addresses) => {
          if (addresses.length === 0) throw dnsFailed();
          if (addresses.some((a) => !isPublicAddress(a.address))) {
            throw new OwnSiteError(
              "blocked_address",
              host,
              "The site name is not a public address",
            );
          }
          const family = wantedFamily(options.family);
          const [first, ...rest] = addresses
            .filter((a) => family === null || a.family === family)
            .map(({ address, family }) => ({ address, family }));
          if (!first) throw dnsFailed();
          return [first, ...rest] as const;
        },
        (error: unknown) => {
          throw error instanceof OwnSiteError ? error : dnsFailed();
        },
      )
      .then(
        ([first, ...rest]) => {
          if (options.all) callback(null, [first, ...rest]);
          else callback(null, first.address, first.family);
        },
        (error: OwnSiteError) => callback(error, []),
      );
  };
}

const systemResolve: OwnSiteResolver = async (hostname) => {
  const found = await dns.promises.lookup(hostname, { all: true });
  return found.map(({ address, family }) => ({ address, family }));
};

const httpsTransport: OwnSiteTransport = {
  get: ({ url, headers, lookup, signal }) =>
    new Promise((resolve, reject) => {
      const request = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers,
          lookup,
          // A fresh connection per request: no pooled socket skips the lookup.
          agent: false,
          signal,
        },
        (response) =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: response,
            close: () => response.destroy(),
          }),
      );
      request.on("error", reject);
      request.end();
    }),
};

function header(headers: OwnSiteTransportResponse["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Bytes 0x80 to 0x9F in windows-1252 (which the Encoding Standard also uses for latin1 labels).
 * Node decodes that range as C1 control characters instead, so curly quotes would be lost.
 */
const WINDOWS_1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f" + "\u0090‘’“”•–—˜™š›œ\u009džŸ";

function decode(bytes: Uint8Array, charset: string | undefined): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset ?? "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  const text = decoder.decode(bytes);
  return decoder.encoding === "windows-1252"
    ? text.replace(/[\u0080-\u009f]/g, (c) => WINDOWS_1252_HIGH[c.charCodeAt(0) - 0x80] ?? c)
    : text;
}

export function createFetchOwnSite(options: CreateFetchOwnSiteOptions = {}) {
  const transport = options.transport ?? httpsTransport;
  const timeoutMs = options.timeoutMs ?? OWN_SITE_TIMEOUT_MS;
  const lookup = createOwnSiteLookup(options.resolve ?? systemResolve);

  return async function fetchOwnSite(
    input: string | URL,
    init: { signal?: AbortSignal } = {},
  ): Promise<OwnSiteResponse> {
    let url = checkOwnSiteUrl(input);
    const host = normalizeHost(url.hostname);
    const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
    const sameSite = new Set([host, twin]);

    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([deadline, init.signal]) : deadline;
    const aborted = new Promise<never>((_, reject) => {
      const stop = () => reject(new OwnSiteError("timeout", host, "The site took too long"));
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    });
    aborted.catch(() => undefined);

    const failure = (error: unknown): OwnSiteError =>
      error instanceof OwnSiteError
        ? error
        : signal.aborted
          ? new OwnSiteError("timeout", host, "The site took too long")
          : new OwnSiteError("network_error", host, "The site could not be reached");

    for (let hop = 0; ; hop++) {
      let response: OwnSiteTransportResponse;
      try {
        response = await Promise.race([
          transport.get({ url, headers: REQUEST_HEADERS, lookup, signal }),
          aborted,
        ]);
      } catch (error) {
        throw failure(error);
      }

      try {
        const location = header(response.headers, "location");
        if (REDIRECT_STATUSES.has(response.status) && location) {
          if (hop === MAX_REDIRECTS) {
            throw new OwnSiteError("too_many_redirects", host, "Too many redirects");
          }
          let target: URL;
          try {
            target = new URL(location, url);
          } catch {
            throw new OwnSiteError("invalid_url", host, "The redirect is not a valid URL");
          }
          const next = checkOwnSiteUrl(target);
          if (!sameSite.has(normalizeHost(next.hostname))) {
            throw new OwnSiteError("redirect_off_site", host, "Redirects stay on the same site");
          }
          url = next;
          continue;
        }

        if (response.status < 200 || response.status >= 300) {
          return { status: response.status, url: url.href, contentType: null, text: "" };
        }

        const contentType = header(response.headers, "content-type") ?? "";
        const mediaType = (contentType.split(";")[0] ?? "").trim().toLowerCase();
        if (!READABLE_TYPES.has(mediaType)) {
          throw new OwnSiteError("unsupported_type", host, "Only HTML and plain text are read");
        }
        const encoding = (header(response.headers, "content-encoding") ?? "identity").trim();
        if (encoding.toLowerCase() !== "identity") {
          throw new OwnSiteError("unsupported_encoding", host, "Compressed bodies are not read");
        }
        const announced = Number(header(response.headers, "content-length"));
        if (Number.isFinite(announced) && announced > OWN_SITE_MAX_BYTES) {
          throw new OwnSiteError("body_too_large", host, "The page is too large");
        }

        const chunks: Uint8Array[] = [];
        let total = 0;
        const iterator = response.body[Symbol.asyncIterator]();
        for (;;) {
          const next = await Promise.race([iterator.next(), aborted]);
          if (next.done) break;
          total += next.value.byteLength;
          if (total > OWN_SITE_MAX_BYTES) {
            throw new OwnSiteError("body_too_large", host, "The page is too large");
          }
          chunks.push(next.value);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const charset = /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1];
        return {
          status: response.status,
          url: url.href,
          contentType: mediaType,
          text: decode(bytes, charset),
        };
      } catch (error) {
        throw failure(error);
      } finally {
        response.close();
      }
    }
  };
}

/** The wired instance: system DNS, node:https. */
export const fetchOwnSite = createFetchOwnSite();
