import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { OG_IMAGE, SITE_NAME, SITE_URL } from "@/lib/seo";
import { dmMono, dmSans, display } from "./fonts";
import "./globals.css";

const DESCRIPTION =
  "Free TLS fingerprint test. See the JA3, JA4 and Akamai HTTP/2 fingerprint your client sends, decoded field by field. No signup, open API.";

export const metadata: Metadata = {
  // Makes the relative OG image path above resolve to an absolute URL, which
  // is the only form crawlers accept.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TLS Fingerprint Test: Check Your JA3, JA4 & HTTP/2 | kittens",
    // Every other page states its own subject and inherits the suffix.
    template: "%s · kittens.sh",
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "Art Freebrey", url: "https://freebrey.art" }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "TLS Fingerprint Test: Check Your JA3, JA4 & HTTP/2 | kittens",
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TLS Fingerprint Test: Check Your JA3, JA4 & HTTP/2 | kittens",
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

/**
 * Site-level facts. `SoftwareApplication` with a zero price is the honest
 * description of what this is, and it is the shape an assistant is most likely
 * to have been trained to read when asked for a tool that does X.
 */
const SITE_SCHEMA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: SITE_NAME,
      description: DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#author` },
    },
    {
      "@type": "Person",
      "@id": `${SITE_URL}/#author`,
      name: "Art Freebrey",
      url: "https://freebrey.art",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#app`,
      name: "kittens.sh",
      url: `${SITE_URL}/`,
      applicationCategory: "DeveloperApplication",
      applicationSubCategory: "Network diagnostics",
      operatingSystem: "Any",
      description:
        "A TLS and HTTP/2 fingerprinting service. It terminates TLS itself, so it reports the JA3, JA4 and Akamai HTTP/2 fingerprint of the connection that reached it, decoded field by field, over a free JSON API with no key.",
      featureList: [
        "JA3 and JA3 string",
        "JA4 fingerprint with both hash halves expanded",
        "Akamai HTTP/2 fingerprint from SETTINGS, WINDOW_UPDATE and PRIORITY frames",
        "Full ClientHello decode in wire order",
        "HTTP/1.1 header order with original casing",
        "Detects a User-Agent that disagrees with the TLS stack behind it",
      ],
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      isAccessibleForFree: true,
      author: { "@id": `${SITE_URL}/#author` },
      codeRepository: "https://github.com/ctrl-cheeb-del/kittens",
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${dmSans.variable} ${dmMono.variable} ${display.variable}`}
      >
        {children}
        <JsonLd data={SITE_SCHEMA} />
      </body>
    </html>
  );
}
