import { allowedHosts } from "@/sources/registry";
import { createSafeFetch } from "./safe-fetch";

export { SafeFetchError, assertAllowedUrl, createSafeFetch } from "./safe-fetch";
export type { SafeFetchInit } from "./safe-fetch";

/** The wired instance: allowlist comes from enabled collect sources in the registry. */
export const safeFetch = createSafeFetch({ getAllowedHosts: () => allowedHosts() });
