import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Exported as plain static files and served by the Rust origin itself, so the
  // page and the fingerprint API share one host — and one TLS connection. The
  // fingerprint shown is therefore taken from the very connection that loaded
  // the page, with no CORS and no second handshake.
  output: "export",
  images: { unoptimized: true },
  // Emit out/docs/index.html rather than out/docs.html so the server can map a
  // request path onto a directory index without special-casing extensions.
  trailingSlash: true,
};

export default config;
