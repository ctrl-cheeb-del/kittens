import { Article, C, Code } from "@/components/Chrome";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata, techArticle } from "@/lib/seo";

const TITLE = "When the User-Agent disagrees with the TLS handshake";
const DESCRIPTION =
  "Why setting a Chrome User-Agent on a Python client changes nothing about its fingerprint, what detectors do with the disagreement, and the false positives that make the rule harder than it looks.";
const PATH = "/guides/ua-mismatch/";

export const metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
});

export default function Guide() {
  return (
    <Article>
      <h1 className="h1 mb-4">User-Agent and handshake disagree</h1>
      <p className="lede mb-10">
        The loudest signal in bot detection is not any single fingerprint. It is
        a client whose header claims one thing while its handshake demonstrates
        another — and it is almost always unintentional, because the two are set
        in completely different places.
      </p>

      <h2 className="h2 mb-4 mt-12">Why headers cannot fix it</h2>
      <p className="lede mb-4">
        A User-Agent is a string your code chooses, sent in the request, after
        the connection is already established. The TLS fingerprint falls out of
        the library performing the handshake, which happened first and which your
        header dictionary has no access to. Changing the former does nothing to
        the latter:
      </p>
      <Code>{`import requests

r = requests.get(
    "https://kittens.sh/api/clean",
    headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) "
                           "Chrome/120.0.0.0 Safari/537.36"},
)
print(r.json())`}</Code>
      <p className="lede mt-4">
        The response comes back with the Chrome User-Agent echoed faithfully and
        a JA4 that is unmistakably Python over OpenSSL. From the server&rsquo;s
        side that is not an ambiguous signal: browsers do not have that
        handshake, and nothing that has that handshake is a browser.
      </p>

      <h2 className="h2 mb-4 mt-12">What a detector does with it</h2>
      <p className="lede mb-4">
        The rule is cheap to run and hard to argue with, which is why it is
        everywhere. In outline:
      </p>
      <ul className="mb-4 space-y-3 text-base text-muted-foreground">
        <li>
          Parse the claimed browser family and major version out of the
          User-Agent.
        </li>
        <li>
          Look up the{" "}
          <a href="/ja4/" className="text-canopy underline-offset-2 hover:underline">
            JA4
          </a>{" "}
          against a table of fingerprints that family is known to produce.
        </li>
        <li>
          Cross-check the{" "}
          <a
            href="/akamai/"
            className="text-canopy underline-offset-2 hover:underline"
          >
            HTTP/2 fingerprint
          </a>
          , which is a separate layer and defeated separately.
        </li>
        <li>
          Score the disagreement rather than blocking on it, because the false
          positives below are real.
        </li>
      </ul>
      <p className="lede">
        This site runs a version of the same comparison and says so plainly on
        the front page: the cat is unimpressed when the handshake and the
        User-Agent tell different stories.
      </p>

      <h2 className="h2 mb-4 mt-12">The false positives</h2>
      <p className="lede mb-4">
        Anyone writing this rule for real hits these within a day. Each produces
        a genuine mismatch from a client that is not lying:
      </p>
      <div className="space-y-4 text-base text-muted-foreground">
        <p>
          <strong className="font-semibold text-ink">
            Corporate TLS interception.
          </strong>{" "}
          Managed devices route through a middlebox that terminates TLS and
          re-originates it. The handshake you measure belongs to the appliance;
          the User-Agent belongs to the genuine browser behind it. Whole
          enterprises look like bots this way.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            Anti-virus and VPN clients.
          </strong>{" "}
          The same mechanism on consumer machines, with a much wider spread of
          appliance fingerprints.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            Embedded browsers and webviews.
          </strong>{" "}
          Electron, CEF, in-app browsers and mobile webviews present
          Chrome-derived User-Agents on top of a build whose TLS configuration is
          its own.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            Anything you put in front of your own origin.
          </strong>{" "}
          A CDN or load balancer that terminates TLS means your origin measures
          the CDN, for every visitor, always. If your fingerprints look
          identical across all traffic, this is why — and it is the reason this
          service terminates TLS itself.
        </p>
        <p>
          <strong className="font-semibold text-ink">Stale tables.</strong> A new
          browser release ships a new fingerprint. Until your table knows about
          it, every early updater is a mismatch. The tables need maintaining, and
          a rule that blocks outright will block real users on release day.
        </p>
      </div>

      <h2 className="h2 mb-4 mt-12">Closing the gap from the client side</h2>
      <p className="lede mb-4">
        If you are the one being flagged and the traffic is legitimate — testing
        your own service, a permitted integration, a crawler operating within a
        site&rsquo;s terms — the fix is not a better header. It is a client that
        controls its own handshake: curl-impersonate and curl_cffi ship
        browser-matched builds, and tls-client and rnet expose the cipher and
        extension ordering directly.
      </p>
      <p className="lede">
        Whichever you choose, check it rather than trusting it —{" "}
        <a
          href="/guides/curl-impersonate/"
          className="text-canopy underline-offset-2 hover:underline"
        >
          verifying an impersonation library
        </a>{" "}
        walks through the comparison, including the HTTP/2 layer that most of
        them leave stock.
      </p>

      <h2 className="h2 mb-4 mt-12">See your own</h2>
      <p className="lede">
        <a href="/" className="text-canopy underline-offset-2 hover:underline">
          The inspector
        </a>{" "}
        shows both sides and says whether they agree. From a script,{" "}
        <C>/api/clean</C> returns the fingerprints and the User-Agent together.
      </p>

      <JsonLd
        data={techArticle({ title: TITLE, description: DESCRIPTION, path: PATH })}
      />
    </Article>
  );
}
