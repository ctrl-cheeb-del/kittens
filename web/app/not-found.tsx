import type { Metadata } from "next";
import { Article } from "@/components/Chrome";

/**
 * Without this the 404 inherits the layout's metadata and claims the home page
 * as its canonical. Next already emits `noindex` for this route, so only the
 * canonical needs clearing.
 */
export const metadata: Metadata = {
  title: "Not found",
  alternates: { canonical: null },
};

export default function NotFound() {
  return (
    <Article>
      <h1 className="h1 mb-4">Not found</h1>
      <p className="lede mb-8">
        No page at that address. The whole site is these:
      </p>
      <ul className="space-y-2 text-base">
        <li>
          <a href="/" className="text-canopy underline-offset-2 hover:underline">
            Inspect your own connection
          </a>{" "}
          <span className="text-muted-foreground">
            — your JA3, JA4 and HTTP/2 fingerprint, decoded
          </span>
        </li>
        <li>
          <a href="/ja4/" className="text-canopy underline-offset-2 hover:underline">
            JA4
          </a>
          ,{" "}
          <a href="/ja3/" className="text-canopy underline-offset-2 hover:underline">
            JA3
          </a>{" "}
          and the{" "}
          <a
            href="/akamai/"
            className="text-canopy underline-offset-2 hover:underline"
          >
            Akamai HTTP/2 fingerprint
          </a>{" "}
          <span className="text-muted-foreground">— what each one is</span>
        </li>
        <li>
          <a
            href="/guides/curl-impersonate/"
            className="text-canopy underline-offset-2 hover:underline"
          >
            Verify an impersonation library
          </a>
          ,{" "}
          <a
            href="/guides/ua-mismatch/"
            className="text-canopy underline-offset-2 hover:underline"
          >
            User-Agent mismatches
          </a>
          ,{" "}
          <a
            href="/guides/ci-assertions/"
            className="text-canopy underline-offset-2 hover:underline"
          >
            pinning a fingerprint in CI
          </a>
        </li>
        <li>
          <a
            href="/docs/"
            className="text-canopy underline-offset-2 hover:underline"
          >
            API reference
          </a>{" "}
          <span className="text-muted-foreground">— every endpoint</span>
        </li>
      </ul>
    </Article>
  );
}
