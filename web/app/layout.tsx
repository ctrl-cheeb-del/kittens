import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "kittens — what your TLS handshake gives away",
  description:
    "See the JA3, JA4 and HTTP/2 fingerprint your client sends, decoded field by field.",
  openGraph: {
    title: "kittens",
    description:
      "See the JA3, JA4 and HTTP/2 fingerprint your client sends, decoded field by field.",
    url: "https://kittens.sh",
    siteName: "kittens",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${mono.variable} ${sans.variable}`}>{children}</body>
    </html>
  );
}
