import type { Metadata } from "next";
import { dmMono, dmSans, display } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "kittens: what your TLS handshake gives away",
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
      <body
        className={`${dmSans.variable} ${dmMono.variable} ${display.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
