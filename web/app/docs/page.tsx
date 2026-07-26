import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "kittens — API",
  description: "Public JSON API for TLS and HTTP/2 fingerprinting.",
};

// Relative, so links work on whatever host this is served from.
const ORIGIN = process.env.NEXT_PUBLIC_ORIGIN_URL ?? "";
// Absolute, for copy-pasteable examples. Docs showing `curl -s /api/clean`
// would be useless.
const PUBLIC_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kittens.sh";

const ENDPOINTS: [string, string][] = [
  ["/api/all", "Everything: decoded TLS, HTTP/2 frames, JA3, JA4"],
  ["/api/clean", "Just the hashes — the one to assert against in CI"],
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

export default function Docs() {
  return (
    <>
      <header className="wrap">
        <div className="masthead">
          <a className="wordmark" href="/">
            kittens<span>.sh</span>
          </a>
          <nav>
            <a href="/">inspect</a>
            <a href={`${ORIGIN}/api/all`}>api</a>
          </nav>
        </div>
      </header>

      <main className="wrap">
        <article className="doc">
          <h1>API</h1>
          <p>
            No key, no rate limit worth worrying about, CORS open to everything.
            Every response describes the connection it arrived on, so the client
            you call it with is the client you measure.
          </p>

          <h2>Endpoints</h2>
          <table>
            <thead>
              <tr>
                <th>Path</th>
                <th>Returns</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map(([path, desc]) => (
                <tr key={path}>
                  <td>{path}</td>
                  <td>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Add <code>?pretty=0</code> for compact JSON. Responses are never
            cached — a cached fingerprint would belong to someone else.
          </p>

          <h2>Check a fingerprint</h2>
          <pre>
            <code>{`curl -s ${PUBLIC_URL}/api/clean`}</code>
          </pre>
          <pre>
            <code>{`{
  "ja3_hash": "375c6162a492dfbf2795909110ce8424",
  "ja4": "t13d4907h2_0d8feac7bc37_7395dae3b2f3",
  "akamai_hash": "64a832f547be33249bf4d33e8a46c5dc",
  "user_agent": "curl/8.7.1"
}`}</code>
          </pre>

          <h2>Assert in CI</h2>
          <p>
            The usual reason to automate this is to prove an impersonation
            library still matches its target after a dependency bump.
          </p>
          <pre>
            <code>{`EXPECTED="t13d1516h2_8daaf6152771_e5627efa2ab1"
GOT=$(curl -s ${PUBLIC_URL}/api/ja4)

if [ "$GOT" != "$EXPECTED" ]; then
  echo "fingerprint drifted: $GOT" >&2
  exit 1
fi`}</code>
          </pre>

          <h2>Watch what changes</h2>
          <p>
            <code>/api/ja4/raw</code> returns JA4 with both hashed halves left
            expanded, so a diff points at the cipher or extension that moved
            instead of just telling you the hash is different.
          </p>
          <pre>
            <code>{`diff <(curl -s ${PUBLIC_URL}/api/ja4/raw) expected.txt`}</code>
          </pre>

          <h2>What the fingerprints are</h2>
          <p>
            <strong>JA4</strong> reads{" "}
            <code>t13d1516h2_8daaf6152771_e5627efa2ab1</code>: TLS over TCP, TLS
            1.3, SNI present, 15 ciphers, 16 extensions, ALPN <code>h2</code>,
            then a hash of the sorted cipher list and a hash of the sorted
            extension list plus signature algorithms. Sorting is what makes it
            survive the extension shuffling that broke JA3.
          </p>
          <p>
            <strong>JA3</strong> is the older MD5 over unsorted fields. Kept
            because plenty of tooling still expects it, but Chrome randomises
            extension order, so it is no longer stable.
          </p>
          <p>
            <strong>Akamai</strong> fingerprints HTTP/2 rather than TLS:
            SETTINGS values in the order sent, the connection WINDOW_UPDATE,
            PRIORITY frames, and pseudo-header order.
          </p>

          <h2>Licensing</h2>
          <p>
            JA3 and JA4 are both BSD-3-Clause. The wider JA4+ suite (JA4H, JA4S
            and the rest) is FoxIO License 1.1, which does not permit
            monetisation without an OEM licence, so none of it is implemented
            here.
          </p>
        </article>
      </main>

      <div className="wrap">
        <footer className="site">
          <span>
            <a href="/">← back to the inspector</a>
          </span>
        </footer>
      </div>
    </>
  );
}
