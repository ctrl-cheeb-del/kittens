/**
 * The written half of the home page, collapsed.
 *
 * It has to be in the HTML: the inspector above it can only describe the
 * visitor's own connection, so a crawler, a link preview, or an assistant
 * fetching this page would otherwise find a page about nothing. It does not
 * have to be *visible* — the tool is the product, and a wall of prose under it
 * buries that. A <details> satisfies both: the text ships in the markup and is
 * indexed, the page stays the fingerprint and nothing else.
 *
 * Deliberately condensed. The full treatment is /about/, and each scheme has
 * its own page; this is the summary that keeps the home page substantive.
 */

import { C } from "@/components/Chrome";
import { FAQ } from "@/lib/faq";

const SCHEMES: { name: string; href: string; body: React.ReactNode }[] = [
  {
    name: "JA4",
    href: "/ja4/",
    body: (
      <>
        The current standard, from FoxIO. Partly readable: <C>t13d1516h2</C> is
        TLS 1.3 over TCP, SNI present, 15 ciphers, 16 extensions, ALPN{" "}
        <C>h2</C>. Two truncated SHA-256 halves follow, over the{" "}
        <em>sorted</em> cipher and extension lists.
      </>
    ),
  },
  {
    name: "JA3",
    href: "/ja3/",
    body: (
      <>
        The 2017 original from Salesforce: an MD5 over version, ciphers,
        extensions, curves and point formats, in the order sent. Still
        everywhere in tooling, and no longer stable for browsers since Chrome
        began shuffling its extension order in 2023.
      </>
    ),
  },
  {
    name: "Akamai HTTP/2",
    href: "/akamai/",
    body: (
      <>
        Not TLS at all. SETTINGS in the order sent, the connection
        WINDOW_UPDATE, PRIORITY frames, and the order of the{" "}
        <C>:method :authority :scheme :path</C> pseudo-headers. A separate
        layer, defeated separately.
      </>
    ),
  },
];

const USES: [string, React.ReactNode][] = [
  [
    "Checking an impersonation library",
    <>
      curl-impersonate, curl_cffi, tls-client and rnet all claim a target
      browser. Whether the build you installed still matches it after a
      dependency bump is an empirical question.{" "}
      <a
        href="/guides/curl-impersonate/"
        className="text-canopy underline-offset-2 hover:underline"
      >
        Verify it →
      </a>
    </>,
  ],
  [
    "Understanding why a client is flagged",
    <>
      A request whose User-Agent says Chrome while its handshake says Python is
      the loudest signal in bot detection, and it is usually unintentional.{" "}
      <a
        href="/guides/ua-mismatch/"
        className="text-canopy underline-offset-2 hover:underline"
      >
        What a mismatch looks like →
      </a>
    </>,
  ],
  [
    "Writing or testing detection rules",
    <>
      Building WAF rules, fraud heuristics or JA4-based blocklists needs ground
      truth for what real clients emit, before you write a rule that fires on
      all of them.
    </>,
  ],
  [
    "Catching drift in CI",
    <>
      A fingerprint changes when your TLS stack changes, including when you did
      not mean to change it.{" "}
      <a
        href="/guides/ci-assertions/"
        className="text-canopy underline-offset-2 hover:underline"
      >
        Pin one →
      </a>
    </>,
  ],
];

export function Explainer() {
  return (
    <details className="panel group mb-10 p-0" data-md>
      <summary className="cursor-pointer list-none px-5 py-4 font-mono text-xs text-muted-foreground transition-colors hover:text-ink">
        <span className="group-open:hidden">▸</span>
        <span className="hidden group-open:inline">▾</span> About TLS
        fingerprinting
      </summary>

      <div className="border-t border-line px-5 py-8">
        {/* The h1: the visual hero above is the visitor's own JA4, which only
            exists once JavaScript has run and differs for every reader. */}
        <h1 className="h2 mb-4 max-w-[52ch]">What a TLS fingerprint is, and how to check yours</h1>
        <div className="mb-10 grid gap-x-10 gap-y-4 text-base text-muted-foreground lg:grid-cols-2">
          <p className="text-pretty">
            Before any HTTP request exists, before a single byte is encrypted,
            your client sends a ClientHello. It announces which TLS versions it
            speaks, which cipher suites it will accept, which extensions it
            supports, which elliptic curves it knows — and it sends all of that
            in a particular order.
          </p>
          <p className="text-pretty">
            That order is not standardised. It falls out of how the underlying
            library was written and configured, so Chrome&rsquo;s BoringSSL,
            Firefox&rsquo;s NSS, Go&rsquo;s crypto/tls and Python&rsquo;s
            OpenSSL bindings each produce a recognisably different ClientHello.
            Hash the interesting fields and you get a short string that
            identifies the TLS stack — not the person, not the machine, but the
            software doing the talking. It is what a server sees before it has
            any opportunity to trust or distrust your User-Agent.
          </p>
        </div>

        <h2 className="label mb-4">The three fingerprints shown above</h2>
        <div className="mb-10 grid gap-6 lg:grid-cols-3">
          {SCHEMES.map(({ name, href, body }) => (
            <div key={name}>
              <h3 className="mb-1.5 font-display text-lg font-bold tracking-tight">
                <a href={href} className="hover:text-canopy">
                  {name}
                </a>
              </h3>
              <p className="text-base text-muted-foreground text-pretty">
                {body}{" "}
                <a
                  href={href}
                  className="text-canopy underline-offset-2 hover:underline"
                >
                  How {name} is built →
                </a>
              </p>
            </div>
          ))}
        </div>

        <h2 className="label mb-4">What people use this for</h2>
        <div className="mb-10 grid gap-6 lg:grid-cols-2">
          {USES.map(([title, body]) => (
            <div key={title}>
              <h3 className="mb-1.5 font-display text-base font-bold tracking-tight">
                {title}
              </h3>
              <p className="text-base text-muted-foreground text-pretty">
                {body}
              </p>
            </div>
          ))}
        </div>

        <h2 className="label mb-4">Common questions</h2>
        <dl className="mb-8 grid gap-6 lg:grid-cols-2">
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <dt className="mb-1.5 font-display text-base font-bold tracking-tight">
                {q}
              </dt>
              <dd className="text-base text-muted-foreground text-pretty">
                {a}
              </dd>
            </div>
          ))}
        </dl>

        <p className="text-base text-muted-foreground">
          <a
            href="/about/"
            className="text-canopy underline-offset-2 hover:underline"
          >
            About this service and how it measures →
          </a>
          <span className="mx-2 text-line">·</span>
          <a
            href="/docs/"
            className="text-canopy underline-offset-2 hover:underline"
          >
            API reference →
          </a>
        </p>
      </div>
    </details>
  );
}
