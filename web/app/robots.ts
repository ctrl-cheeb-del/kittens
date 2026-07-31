import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Metadata routes are dynamic by default; `output: export` needs them pinned.
export const dynamic = "force-static";

/**
 * Everything is public, including /api — an assistant that fetches
 * /api/clean while answering a question is the tool working as intended, and
 * the responses are per-connection and uncacheable so there is nothing there
 * to index badly.
 *
 * The named crawlers are listed only to be explicit. A bot that matches its
 * own user-agent group ignores the wildcard group entirely, so each one has to
 * repeat the same allow.
 */
export default function robots(): MetadataRoute.Robots {
  const allowAll = { allow: "/", disallow: [] as string[] };
  return {
    rules: [
      { userAgent: "*", ...allowAll },
      { userAgent: "Googlebot", ...allowAll },
      { userAgent: "Bingbot", ...allowAll },
      { userAgent: "GPTBot", ...allowAll },
      { userAgent: "OAI-SearchBot", ...allowAll },
      { userAgent: "ChatGPT-User", ...allowAll },
      { userAgent: "ClaudeBot", ...allowAll },
      { userAgent: "Claude-User", ...allowAll },
      { userAgent: "Claude-SearchBot", ...allowAll },
      { userAgent: "PerplexityBot", ...allowAll },
      { userAgent: "Perplexity-User", ...allowAll },
      { userAgent: "Google-Extended", ...allowAll },
      { userAgent: "Applebot", ...allowAll },
      { userAgent: "Applebot-Extended", ...allowAll },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
