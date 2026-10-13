/**
 * safeFetch: the only way application code may make an outbound HTTP request.
 *
 * It refuses any host that is not on the allowlist, any non-https URL, URLs with credentials or a
 * non-default port, and any redirect that leaves the allowlist. The CI gate `compliance:hosts`
 * fails if code calls the network any other way.
 *
 * The allowlist is resolved on every request so kill switches take effect immediately. It is
 * injected, not imported, so source modules can import safeFetch without a cycle through the
 * registry. See ./index.ts for the wired instance.
 */

export type SafeFetchErrorCode =
  | "invalid_url"
  | "insecure_scheme"
  | "credentials_in_url"
  | "non_default_port"
  | "host_not_allowed"
  | "too_many_redirects"
  | "redirect_on_unsafe_method";

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    readonly host: string,
    message: string,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchInit extends Omit<RequestInit, "redirect" | "signal"> {
  timeoutMs?: number;
}

export interface CreateSafeFetchOptions {
  getAllowedHosts: () => readonly string[];
  fetchImpl?: typeof globalThis.fetch;
  defaultTimeoutMs?: number;
}

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

const normalizeHost = (host: string): string => host.toLowerCase().replace(/\.$/, "");

export function assertAllowedUrl(raw: string | URL, allowed: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("invalid_url", String(raw), "Not a valid URL");
  }
  const host = normalizeHost(url.hostname);
  if (url.protocol !== "https:") {
    throw new SafeFetchError("insecure_scheme", host, "Only https URLs are allowed");
  }
  if (url.username || url.password) {
    throw new SafeFetchError("credentials_in_url", host, "URLs with credentials are not allowed");
  }
  if (url.port && url.port !== "443") {
    throw new SafeFetchError("non_default_port", host, "Non-default ports are not allowed");
  }
  if (!allowed.some((a) => normalizeHost(a) === host)) {
    throw new SafeFetchError("host_not_allowed", host, `Host is not on the allowlist: ${host}`);
  }
  return url;
}

export function createSafeFetch(options: CreateSafeFetchOptions) {
  const defaultTimeout = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function safeFetch(
    input: string | URL,
    init: SafeFetchInit = {},
  ): Promise<Response> {
    const { timeoutMs = defaultTimeout, ...rest } = init;
    const doFetch = options.fetchImpl ?? globalThis.fetch;
    const method = (rest.method ?? "GET").toUpperCase();

    let url = assertAllowedUrl(input, options.getAllowedHosts());

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Redirects are followed by hand so every hop is checked against the allowlist.
      const response = await doFetch(url, {
        ...rest,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });

      const isRedirect = response.status >= 300 && response.status < 400;
      const location = response.headers.get("location");
      if (!isRedirect || !location) return response;

      if (method !== "GET" && method !== "HEAD") {
        throw new SafeFetchError(
          "redirect_on_unsafe_method",
          normalizeHost(url.hostname),
          "Redirects are only followed for GET and HEAD",
        );
      }
      url = assertAllowedUrl(new URL(location, url), options.getAllowedHosts());
    }

    throw new SafeFetchError(
      "too_many_redirects",
      normalizeHost(url.hostname),
      "Too many redirects",
    );
  };
}
