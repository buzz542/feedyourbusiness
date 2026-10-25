import type { MetadataRoute } from "next";
import { robotsTxt } from "@/lib/launch";

/** Everything disallowed until the launch switch (src/lib/launch.ts). */
export default function robots(): MetadataRoute.Robots {
  return robotsTxt();
}
