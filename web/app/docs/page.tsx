import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "kittens: API",
  description: "Public JSON API for TLS and HTTP/2 fingerprinting.",
};

// Relative, so links work on whatever host this is served from.
const ORIGIN = process.env.NEXT_PUBLIC_ORIGIN_URL ?? "";
// Absolute, for copy-pasteable examples. Docs showing `curl -s /api/clean`
// would be useless.
const PUBLIC_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kittens.sh";

const ENDPOINTS: [string, string][] = [
  ["/api/all", "Everything: decoded TLS, HTTP/2 frames, JA3, JA4"],
  ["/api/clean", "Just the hashes. The one to assert against in CI"],
  ["/api/tls", "ClientHello detail only"],
  ["/api/http2", "SETTINGS, WINDOW_UPDATE, PRIORITY, pseudo-header order"],
  ["/api/http1", "HTTP/1.1 headers in wire order, original casing"],
  ["/api/ja3", "JA3 hash, plain text"],
  ["/api/ja3/full", "Unhashed JA3 string"],
  ["/api/ja4", "JA4 fingerprint, plain text"],
  ["/api/ja4/raw", "JA4 with both hash halves expanded"],
  ["/api/akamai", "Akamai HTTP/2 fingerprint, plain text"],
  ["/api/ip", "Your IP"],
];

function Code({ children }: { children: string }) {
  return (
    <pre className="no-scrollbar overflow-x-auto rounded-2xl border border-line bg-card p-4 font-mono text-[12px] leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

export default function Docs() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-[1240px] items-center justify-between px-6 py-5 lg:px-8">
          <a href="/" className="font-display text-lg font-extrabold tracking-tight">
            kittens<span className="text-canopy">.sh</span>
          </a>
          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="/" className="transition-colors hover:text-ink">
              Inspect
            </a>
            <a href={`${ORIGIN}/api/all`} className="transition-colors hover:text-ink">
              API
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1240px] px-6 lg:px-8">
        <article className="max-w-[740px] py-14 lg:py-20">
          <h1 className="h1 mb-4">API</h1>
          <p className="lede mb-10">
            No key, no meaningful rate limit, CORS open to everything. Every
            response describes the connection it arrived on, so the client you
            call it with is the client you measure.
          </p>

          <h2 className="h2 mb-4 mt-12">Endpoints</h2>
          <div className="overflow-hidden rounded-2xl border border-line bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="label px-4 py-3 text-left">Path</th>
                  <th className="label px-4 py-3 text-left">Returns</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map(([path, desc]) => (
                  <tr key={path} className="border-b border-line/60 last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-canopy">
                      {path}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lede mt-4">
            Add <code className="font-mono text-[13px] text-canopy">?pretty=0</code>{" "}
            for compact JSON. Responses are never cached, because a cached
            fingerprint would belong to someone else.
          </p>

          <h2 className="h2 mb-4 mt-12">Check a fingerprint</h2>
          <div className="space-y-3">
            <Code>{`curl -s ${PUBLIC_URL}/api/clean`}</Code>
            <Code>{`{
  "ja3_hash": "375c6162a492dfbf2795909110ce8424",
  "ja4": "t13d4907h2_0d8feac7bc37_7395dae3b2f3",
  "akamai_hash": "64a832f547be33249bf4d33e8a46c5dc",
  "user_agent": "curl/8.7.1"
}`}</Code>
          </div>

          <h2 className="h2 mb-4 mt-12">Assert in CI</h2>
          <p className="lede mb-4">
            The usual reason to automate this: proving an impersonation library
            still matches its target after a dependency bump.
          </p>
          <Code>{`EXPECTED="t13d1516h2_8daaf6152771_e5627efa2ab1"
GOT=$(curl -s ${PUBLIC_URL}/api/ja4)

if [ "$GOT" != "$EXPECTED" ]; then
  echo "fingerprint drifted: $GOT" >&2
  exit 1
fi`}</Code>

          <h2 className="h2 mb-4 mt-12">See what changed</h2>
          <p className="lede mb-4">
            <code className="font-mono text-[13px] text-canopy">/api/ja4/raw</code>{" "}
            returns JA4 with both hashed halves expanded, so a diff points at
            the cipher or extension that moved instead of just telling you the
            hash is different.
          </p>
          <Code>{`diff <(curl -s ${PUBLIC_URL}/api/ja4/raw) expected.txt`}</Code>

          <h2 className="h2 mb-4 mt-12">What the fingerprints are</h2>
          <div className="space-y-4 text-base text-muted-foreground">
            <p>
              <strong className="font-semibold text-ink">JA4</strong> reads{" "}
              <code className="font-mono text-[13px] text-canopy">
                t13d1516h2_8daaf6152771_e5627efa2ab1
              </code>
              : TLS over TCP, TLS 1.3, SNI present, 15 ciphers, 16 extensions,
              ALPN h2. Then a hash of the sorted cipher list, and a hash of the
              sorted extension list plus signature algorithms. Sorting is what
              lets it survive the extension shuffling that broke JA3.
            </p>
            <p>
              <strong className="font-semibold text-ink">JA3</strong> is the
              older MD5 over unsorted fields. Kept because plenty of tooling
              still expects it, but Chrome randomises extension order, so it is
              no longer stable.
            </p>
            <p>
              <strong className="font-semibold text-ink">Akamai</strong>{" "}
              fingerprints HTTP/2 rather than TLS: SETTINGS values in the order
              sent, the connection WINDOW_UPDATE, PRIORITY frames, and
              pseudo-header order.
            </p>
          </div>

          <h2 className="h2 mb-4 mt-12">Licensing</h2>
          <p className="lede">
            JA3 and JA4 are both BSD-3-Clause. The wider JA4+ suite (JA4H, JA4S
            and the rest) is FoxIO License 1.1, which does not permit
            monetisation without an OEM licence, so none of it is implemented
            here.
          </p>
        </article>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-sm text-muted-foreground lg:px-8">
          <a href="/" className="transition-colors hover:text-ink">
            ← Back to the inspector
          </a>
          <span>
            Sponsored by{" "}
            <a
              href="https://revnu.com"
              className="font-medium text-canopy underline-offset-2 hover:underline"
            >
              Revnu
            </a>
          </span>
          <span>
            Made by{" "}
            <a
              href="https://freebrey.art"
              className="font-medium text-ink underline-offset-2 hover:underline"
            >
              Art Freebrey
            </a>
          </span>
          <a
            href="https://github.com/ctrl-cheeb-del/kittens"
            className="underline-offset-2 hover:text-ink hover:underline"
          >
            Source
          </a>
        </div>
      </footer>
    </div>
  );
}
