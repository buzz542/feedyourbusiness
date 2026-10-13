import type { MetadataRoute } from "next";

// Pre-launch: disallow everything. Replace with the real rules at launch.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
