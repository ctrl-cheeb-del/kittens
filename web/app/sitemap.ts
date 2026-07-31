import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Metadata routes are dynamic by default; `output: export` needs them pinned.
export const dynamic = "force-static";

/**
 * Paths carry the trailing slash the export actually emits, so the sitemap
 * agrees with the canonical each page declares. Priorities are relative: the
 * inspector is the product, the concept pages are what people search for, the
 * guides are the long tail.
 */
const PAGES: [string, number][] = [
  ["/", 1.0],
  ["/about/", 0.8],
  ["/ja4/", 0.9],
  ["/ja3/", 0.9],
  ["/akamai/", 0.8],
  ["/docs/", 0.8],
  ["/guides/curl-impersonate/", 0.7],
  ["/guides/ua-mismatch/", 0.7],
  ["/guides/ci-assertions/", 0.7],
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(([path, priority]) => ({
    url: new URL(path, SITE_URL).toString(),
    changeFrequency: "monthly",
    priority,
  }));
}
