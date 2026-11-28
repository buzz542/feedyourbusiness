import type { MetadataRoute } from "next";
import { isLaunchOpen } from "@/lib/launch";
import { SITE_URL } from "@/lib/seo";

/** The public pages search engines may list. Empty while the site is closed (src/lib/launch.ts). */
const PUBLIC_PATHS = [
  "/",
  "/pricing",
  "/sources",
  "/terms",
  "/acceptable-use",
  "/privacy",
  "/cookies",
  "/remove-my-post",
] as const;

const SITE = SITE_URL;

export default function sitemap(): MetadataRoute.Sitemap {
  if (!isLaunchOpen()) return [];
  return PUBLIC_PATHS.map((path) => ({ url: `${SITE}${path}` }));
}
