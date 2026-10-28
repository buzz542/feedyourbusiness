import "server-only";
import dns from "node:dns";
import https from "node:https";
import { isPublicAddress } from "./ip";
import { isPlatformHost, mentionsPlatform, normalizeHost } from "./platform-hosts";

/**
 * fetchOwnSite (docs/PLAN.md 12.3): fetch the user's own product page once, for the onboarding
 * draft. The only file besides safeFetch allowed to open connections (the hosts gate enforces it).
 *
 *   * https on port 443 only, no credentials, no cookies, at most 3 redirects, each within the same
 *     host or its www twin, 10 second timeout, 2 MB body cap, text/html or text/plain only.
 *   * Every platform host is refused, on the first URL and on every redirect (2.1.10), and so is
 *     any path or query that names one, which is how a reader or proxy takes its target. The
 *     first URL loses its query and fragment: a product page needs neither.
 *   * No IP address as the host: no product site is a bare address.
 *   * The connection resolves the name through our own lookup, which refuses loopback, private,
 *     link-local, CGNAT, multicast, reserved and the IPv6 equivalents, on every connection. The
 *     address that was checked is the address connected to, so DNS rebinding has no gap.
 */

export type OwnSiteErrorCode =
  | "invalid_url"
  | "insecure_scheme"
  | "credentials_in_url"
  | "non_default_port"
  | "platform_host"
  | "ip_literal"
  | "private_address"
  | "dns_failed"
  | "redirect_off_site"
  | "too_many_redirects"
  | "http_status"
  | "not_html"
  | "too_large"
  | "timeout"
  | "network";

export class OwnSiteError extends Error {
  override name = "OwnSiteError";
  constructor(readonly code: OwnSiteErrorCode) {
    super(`fetchOwnSite refused: ${code}`);
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (host: string) => Promise<ResolvedAddress[]>;

/** The lookup signature node:net uses, with and without `all`. */
export type SafeLookup = (
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (error: Error | null, address?: string | ResolvedAddress[], family?: number) => void,
) => void;

export interface RawResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  abort(): void;
}

export type Transport = (request: {
  url: URL;
  lookup: SafeLookup;
  signal: AbortSignal;
  headers: Record<string, string>;
}) => Promise<RawResponse>;

export interface OwnSitePage {
  url: string;
  contentType: "text/html" | "text/plain";
  body: string;
}

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const HEADERS = {
  "user-agent": "AskedFor/1.0 (+https://askedfor.app)",
  accept: "text/html, text/plain;q=0.9",
  // No compression: the body is read as sent, and the size cap counts what we decode.
  "accept-encoding": "identity",
};

const isIpLiteral = (host: string) => /^[\d.]+$/.test(host) || host.includes(":");
const sameSite = (a: string, b: string) => a === b || a === `www.${b}` || b === `www.${a}`;

/** Every check that needs no network, for the first URL and for each redirect target. */
function checkUrl(raw: string | URL, from: string | null): { url: URL; host: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OwnSiteError("invalid_url");
  }
  if (url.protocol !== "https:") throw new OwnSiteError("insecure_scheme");
  if (url.username || url.password) throw new OwnSiteError("credentials_in_url");
  if (url.port && url.port !== "443") throw new OwnSiteError("non_default_port");
  url.hash = "";
  if (from === null) url.search = "";
  const host = normalizeHost(url.hostname);
  if (host.split(".").includes("")) throw new OwnSiteError("invalid_url");
  if (isPlatformHost(host)) throw new OwnSiteError("platform_host");
  if (mentionsPlatform(url.pathname + url.search)) throw new OwnSiteError("platform_host");
  if (isIpLiteral(host)) throw new OwnSiteError("ip_literal");
  if (from !== null && !sameSite(from, host)) throw new OwnSiteError("redirect_off_site");
  return { url, host };
}

/** A lookup that resolves, refuses the whole answer if any address is not public, then connects. */
function safeLookup(resolve: Resolver): SafeLookup {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) return callback(new OwnSiteError("dns_failed"));
        if (!addresses.every((a) => isPublicAddress(a.address)))
          return callback(new OwnSiteError("private_address"));
        if (options.all) return callback(null, addresses);
        const first = addresses[0]!;
        callback(null, first.address, first.family);
      },
      () => callback(new OwnSiteError("dns_failed")),
    );
  };
}

const systemResolve: Resolver = async (host) => {
  const results = await dns.promises.lookup(host, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/** node:https with our lookup, no agent (so no pooled socket skips the check) and no cookies. */
const nodeTransport: Transport = ({ url, lookup, signal, headers }) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      // rejectUnauthorized is the default; stated so no later edit can drop certificate checks.
      {
        method: "GET",
        headers,
        lookup: lookup as never,
        agent: false,
        signal,
        rejectUnauthorized: true,
      },
      (response) => {
        const flat: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(response.headers))
          flat[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
        resolve({
          status: response.statusCode ?? 0,
          headers: flat,
          body: response,
          abort: () => response.destroy(),
        });
      },
    );
    request.on("error", reject);
    request.end();
  });

function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase();
}

/** The page's declared charset, or UTF-8 when it names none or one we do not know. */
function decoderFor(contentType: string | undefined): TextDecoder {
  const label = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? "")?.[1];
  try {
    return new TextDecoder(label ?? "utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
}

async function readBody(
  response: RawResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.abort();
    throw new OwnSiteError("too_large");
  }
  const decoder = decoderFor(response.headers["content-type"]);
  let received = 0;
  let text = "";
  for await (const chunk of response.body) {
    // node:https destroys the stream on abort; this also stops any body that keeps yielding.
    if (signal.aborted) {
      response.abort();
      throw new OwnSiteError("timeout");
    }
    received += chunk.byteLength;
    if (received > maxBytes) {
      response.abort();
      throw new OwnSiteError("too_large");
    }
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

export function createFetchOwnSite(options: {
  resolve?: Resolver;
  transport?: Transport;
  timeoutMs?: number;
  maxBytes?: number;
}) {
  const lookup = safeLookup(options.resolve ?? systemResolve);
  const transport = options.transport ?? nodeTransport;
  const maxBytes = options.maxBytes ?? MAX_BYTES;

  return async function fetchSite(input: string): Promise<OwnSitePage> {
    const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
    const first = checkUrl(input, null);
    let url = first.url;
    const origin = first.host;

    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await transport({ url, lookup, signal, headers: HEADERS });
        const location = response.headers.location;
        if (REDIRECTS.has(response.status) && location) {
          response.abort();
          if (hop === MAX_REDIRECTS) throw new OwnSiteError("too_many_redirects");
          url = checkUrl(new URL(location, url), origin).url;
          continue;
        }
        if (response.status < 200 || response.status > 299) {
          response.abort();
          throw new OwnSiteError("http_status");
        }
        const type = mediaType(response.headers["content-type"]);
        if (type !== "text/html" && type !== "text/plain") {
          response.abort();
          throw new OwnSiteError("not_html");
        }
        const body = await readBody(response, maxBytes, signal);
        return { url: url.href, contentType: type, body };
      }
      throw new OwnSiteError("too_many_redirects");
    } catch (error) {
      if (error instanceof OwnSiteError) throw error;
      if (signal.aborted) throw new OwnSiteError("timeout");
      throw new OwnSiteError("network");
    }
  };
}

/** The wired instance: the system resolver and node:https. */
export const fetchOwnSite = createFetchOwnSite({});
