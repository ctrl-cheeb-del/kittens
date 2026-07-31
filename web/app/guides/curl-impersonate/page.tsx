import { Article, C, Code } from "@/components/Chrome";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata, techArticle } from "@/lib/seo";

const TITLE = "Verify curl-impersonate actually impersonates";
const DESCRIPTION =
  "How to check that curl-impersonate, curl_cffi, tls-client or any other browser-impersonating HTTP client really produces its target's TLS and HTTP/2 fingerprint — and what to do when it does not.";
const PATH = "/guides/curl-impersonate/";

export const metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
});

export default function Guide() {
  return (
    <Article>
      <h1 className="h1 mb-4">Verify an impersonation library</h1>
      <p className="lede mb-10">
        Libraries like curl-impersonate, curl_cffi, tls-client and rnet all
        promise to make your requests indistinguishable from a named browser.
        Whether the build you actually installed still does that — after your
        package manager resolved it, after a transitive dependency moved, after
        the browser it targets shipped a new version — is an empirical question
        with a one-command answer.
      </p>

      <h2 className="h2 mb-4 mt-12">The check</h2>
      <p className="lede mb-4">
        Point the client at <C>/api/clean</C> and read what came back. The
        response describes the connection it arrived on, so this measures the
        client you used, not the machine you ran it from.
      </p>
      <Code>{`$ curl_chrome116 -s https://kittens.sh/api/clean
{
  "ja3_hash": "cd08e31494f9531f560d64c695473da9",
  "ja4": "t13d1516h2_8daaf6152771_b0da82dd1658",
  "akamai_hash": "52d84b11737d980aef856699f885ca86",
  "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ..."
}`}</Code>

      <h2 className="h2 mb-4 mt-12">Getting the target to compare against</h2>
      <p className="lede mb-4">
        A fingerprint on its own tells you nothing — you need the one you are
        trying to match. Open{" "}
        <a href="/" className="text-canopy underline-offset-2 hover:underline">
          the inspector
        </a>{" "}
        in the real browser, on the real platform, and copy its JA4. Two things
        make this go wrong:
      </p>
      <ul className="mb-4 space-y-3 text-base text-muted-foreground">
        <li>
          <strong className="font-semibold text-ink">Platform matters.</strong>{" "}
          Chrome on macOS and Chrome on Windows do not produce identical
          handshakes. Impersonation targets are usually specified as
          browser-plus-platform; compare against the same one.
        </li>
        <li>
          <strong className="font-semibold text-ink">
            Browser JA3 is not a stable target.
          </strong>{" "}
          Chrome randomises extension order, so its{" "}
          <a href="/ja3/" className="text-canopy underline-offset-2 hover:underline">
            JA3
          </a>{" "}
          differs on every reload. Compare JA4, which sorts before hashing. If a
          tool advertises a fixed Chrome JA3, that claim expired in 2023.
        </li>
      </ul>

      <h2 className="h2 mb-4 mt-12">Compare all three layers</h2>
      <p className="lede mb-4">
        A matching JA4 is necessary and not sufficient. The three fingerprints
        come from different layers and are defeated independently:
      </p>
      <div className="overflow-hidden rounded-2xl border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="label px-4 py-3 text-left">Match</th>
              <th className="label px-4 py-3 text-left">Mismatch means</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line/60">
              <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-[12px] text-canopy">
                ja4
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">
                The TLS handshake itself is wrong. Usually the build is not being
                used at all — see below.
              </td>
            </tr>
            <tr className="border-b border-line/60">
              <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-[12px] text-canopy">
                akamai_hash
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">
                TLS is right and HTTP/2 is not: wrong SETTINGS, no
                WINDOW_UPDATE, or the pseudo-headers in the wrong order. Common
                in libraries that patched the TLS layer and left the HTTP layer
                stock.
              </td>
            </tr>
            <tr>
              <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-[12px] text-canopy">
                user_agent
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">
                The easy one, and the one people get wrong anyway by setting a
                Chrome UA on a build that impersonates Firefox.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="lede mt-4">
        <C>/api/http2</C> returns the frames unhashed, so when the Akamai hash
        differs you can see which setting moved rather than guessing.
      </p>

      <h2 className="h2 mb-4 mt-12">When the JA4 is completely wrong</h2>
      <p className="lede mb-4">
        If the fingerprint looks nothing like a browser, the impersonating build
        is almost certainly not the one that ran. In rough order of how often
        this is the cause:
      </p>
      <ul className="mb-4 space-y-3 text-base text-muted-foreground">
        <li>
          <strong className="font-semibold text-ink">
            The system curl answered.
          </strong>{" "}
          curl-impersonate ships wrapper scripts — <C>curl_chrome116</C> and
          friends — that set the flags and preload the patched library. Invoking
          plain <C>curl</C> gets you your distribution&rsquo;s build with your
          distribution&rsquo;s OpenSSL. Check with <C>which</C> and confirm the
          fingerprint changes between the two.
        </li>
        <li>
          <strong className="font-semibold text-ink">
            The wrapper found the wrong library.
          </strong>{" "}
          The wrappers rely on <C>LD_PRELOAD</C> (or{" "}
          <C>DYLD_INSERT_LIBRARIES</C> on macOS). If the patched libcurl is not
          where the script expects, the preload silently fails and the request
          still succeeds — with the stock stack.
        </li>
        <li>
          <strong className="font-semibold text-ink">
            A proxy is terminating TLS.
          </strong>{" "}
          Corporate interception, mitmproxy, or a debugging proxy will complete
          the handshake itself and open a fresh one to the origin. What gets
          measured is the proxy. This is worth ruling out first if the
          fingerprint is stable but unfamiliar.
        </li>
        <li>
          <strong className="font-semibold text-ink">
            In Python, the wrong session type.
          </strong>{" "}
          <C>curl_cffi</C> only impersonates when you ask it to. A bare{" "}
          <C>requests.get</C> from the standard library is still the standard
          library.
        </li>
      </ul>
      <Code>{`# curl_cffi: impersonation is opt-in, per request or per session
from curl_cffi import requests

r = requests.get("https://kittens.sh/api/clean", impersonate="chrome")
print(r.json()["ja4"])`}</Code>

      <h2 className="h2 mb-4 mt-12">Then keep it verified</h2>
      <p className="lede">
        Fingerprints drift silently — a rebuilt image, a bumped dependency, a new
        upstream release — and the failure mode is a client that quietly stops
        matching its target weeks before anyone notices.{" "}
        <a
          href="/guides/ci-assertions/"
          className="text-canopy underline-offset-2 hover:underline"
        >
          Pinning the fingerprint in CI
        </a>{" "}
        turns that into a failed build. If the User-Agent and the handshake are
        the pair that disagree, that case has{" "}
        <a
          href="/guides/ua-mismatch/"
          className="text-canopy underline-offset-2 hover:underline"
        >
          its own page
        </a>
        .
      </p>

      <JsonLd
        data={techArticle({ title: TITLE, description: DESCRIPTION, path: PATH })}
      />
    </Article>
  );
}
