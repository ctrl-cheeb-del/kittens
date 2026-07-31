import { Article, C, Code } from "@/components/Chrome";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL, pageMetadata, techArticle } from "@/lib/seo";

const TITLE = "TLS fingerprint API";
const DESCRIPTION =
  "Free JSON API returning the JA3, JA4 and Akamai HTTP/2 fingerprint of the connection that calls it. No key, CORS open, nothing stored.";
const PATH = "/docs/";

export const metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
});

// Absolute, for copy-pasteable examples. Docs showing `curl -s /api/clean`
// would be useless.
const PUBLIC_URL = SITE_URL;

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

export default function Docs() {
  return (
    <Article>
      <h1 className="h1 mb-4">API</h1>
      <p className="lede mb-10">
        No key, no meaningful rate limit, CORS open to everything. Every response
        describes the connection it arrived on, so the client you call it with is
        the client you measure.
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
        Add <C>?pretty=0</C> for compact JSON. Responses are never cached,
        because a cached fingerprint would belong to someone else.
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
        The usual reason to automate this: proving an impersonation library still
        matches its target after a dependency bump.{" "}
        <a
          href="/guides/ci-assertions/"
          className="text-canopy underline-offset-2 hover:underline"
        >
          The longer version →
        </a>
      </p>
      <Code>{`EXPECTED="t13d1516h2_8daaf6152771_e5627efa2ab1"
GOT=$(curl -s ${PUBLIC_URL}/api/ja4)

if [ "$GOT" != "$EXPECTED" ]; then
  echo "fingerprint drifted: $GOT" >&2
  exit 1
fi`}</Code>

      <h2 className="h2 mb-4 mt-12">See what changed</h2>
      <p className="lede mb-4">
        <C>/api/ja4/raw</C> returns JA4 with both hashed halves expanded, so a
        diff points at the cipher or extension that moved instead of just telling
        you the hash is different.
      </p>
      <Code>{`diff <(curl -s ${PUBLIC_URL}/api/ja4/raw) expected.txt`}</Code>

      <h2 className="h2 mb-4 mt-12">What the fingerprints are</h2>
      <div className="space-y-4 text-base text-muted-foreground">
        <p>
          <strong className="font-semibold text-ink">
            <a href="/ja4/" className="hover:text-canopy">
              JA4
            </a>
          </strong>{" "}
          reads <C>t13d1516h2_8daaf6152771_e5627efa2ab1</C>: TLS over TCP, TLS
          1.3, SNI present, 15 ciphers, 16 extensions, ALPN h2. Then a hash of
          the sorted cipher list, and a hash of the sorted extension list plus
          signature algorithms. Sorting is what lets it survive the extension
          shuffling that broke JA3.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            <a href="/ja3/" className="hover:text-canopy">
              JA3
            </a>
          </strong>{" "}
          is the older MD5 over unsorted fields. Kept because plenty of tooling
          still expects it, but Chrome randomises extension order, so it is no
          longer stable.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            <a href="/akamai/" className="hover:text-canopy">
              Akamai
            </a>
          </strong>{" "}
          fingerprints HTTP/2 rather than TLS: SETTINGS values in the order sent,
          the connection WINDOW_UPDATE, PRIORITY frames, and pseudo-header order.
        </p>
      </div>

      <h2 className="h2 mb-4 mt-12">Licensing</h2>
      <p className="lede">
        JA3 and JA4 are both BSD-3-Clause. The wider JA4+ suite (JA4H, JA4S and
        the rest) is FoxIO License 1.1, which does not permit monetisation
        without an OEM licence, so none of it is implemented here.
      </p>

      <JsonLd
        data={techArticle({
          title: TITLE,
          description: DESCRIPTION,
          path: PATH,
        })}
      />
    </Article>
  );
}
