import type { MetadataRoute } from "next";
import { isLaunchOpen } from "@/lib/launch";

// Closed: disallow everything. Open (LAUNCH_OPEN=true): the public pages can be crawled, the app,
// admin and API stay out of search results.
export default function robots(): MetadataRoute.Robots {
  if (!isLaunchOpen()) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api"] } };
}
