/**
 * One place for the canonical origin and the per-page metadata shape.
 *
 * Every page declares its own canonical. The export serves `/ja3/` but a link
 * or a crawler will also reach `/ja3`, and without an explicit canonical those
 * are two URLs holding the same page.
 */

import type { Metadata } from "next";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kittens.sh";
export const SITE_NAME = "kittens";
export const OG_IMAGE = "/og.png";

/**
 * Structured data for a written page. `TechArticle` rather than `Article`
 * because every one of these is reference material about a protocol, and the
 * distinction is the sort of thing a retrieval system uses to decide whether a
 * page answers a technical question.
 */
export function techArticle({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  const url = new URL(path, SITE_URL).toString();
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "@id": `${url}#article`,
    headline: title,
    description,
    url,
    mainEntityOfPage: url,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    author: { "@id": `${SITE_URL}/#author` },
    publisher: { "@id": `${SITE_URL}/#author` },
    inLanguage: "en",
  };
}

export function pageMetadata({
  title,
  description,
  path,
}: {
  /** Written without the site name; the layout template appends it. */
  title: string;
  description: string;
  /** Site-relative, with the trailing slash the export actually emits. */
  path: string;
}): Metadata {
  const url = new URL(path, SITE_URL).toString();
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title,
      description,
      url,
      siteName: SITE_NAME,
      images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE],
    },
  };
}
