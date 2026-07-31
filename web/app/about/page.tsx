import { Article, C, Code } from "@/components/Chrome";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata, techArticle } from "@/lib/seo";

const TITLE = "About kittens.sh";
const DESCRIPTION =
  "What this service measures, how it measures it, and why terminating TLS itself is the only way to report a fingerprint that belongs to you rather than to a proxy in front of it.";
const PATH = "/about/";

export const metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
});

export default function About() {
  return (
    <Article>
      <h1 className="h1 mb-4">About</h1>
      <p className="lede mb-10">
        kittens.sh reports the TLS and HTTP/2 fingerprint of whatever connects
        to it. Not a description of what your client probably looks like — the
        actual bytes it sent, decoded field by field, taken from the connection
        you are reading this over.
      </p>

      <h2 className="h2 mb-4 mt-12">Why it terminates TLS itself</h2>
      <p className="lede mb-4">
        Almost everything that could sit in front of a web service destroys the
        thing this service exists to measure. A CDN, a load balancer or a
        reverse proxy completes the TLS handshake itself and opens a fresh one
        to the origin behind it. The origin then measures the proxy — the same
        fingerprint, for every visitor, forever.
      </p>
      <p className="lede mb-4">
        So there is nothing in front of this. The server terminates TLS
        directly, which means it sees the raw ClientHello before any library has
        parsed and normalised it away. It speaks HTTP/2 itself rather than
        delegating to a framework, so it keeps the frame ordering that a normal
        HTTP library discards on the way to handing you a request object. And it
        serves this page from the same process as the API, so the page you are
        reading and the fingerprint it reports came over one connection.
      </p>
      <p className="lede">
        That last detail is the reason the number on the front page is
        trustworthy. If the site were served from one host and the API from
        another, you would be shown a fingerprint from a different handshake
        than the one that loaded the page — close enough to look right, wrong
        often enough to matter.
      </p>

      <h2 className="h2 mb-4 mt-12">What is actually being read</h2>
      <p className="lede mb-4">
        A TLS ClientHello is a list of capabilities. Your client says which
        protocol versions it speaks, which cipher suites it will accept, which
        extensions it understands, which elliptic curves and signature
        algorithms it supports, and which key shares it has already generated on
        the assumption the server will pick one.
      </p>
      <p className="lede mb-4">
        None of that is secret and none of it is unusual. What makes it a
        fingerprint is that no specification says what order to send it in, or
        which optional pieces to include. Those decisions were made once, by
        whoever wrote the TLS library, and they are then made identically by
        every program that uses it. Chrome&rsquo;s BoringSSL, Firefox&rsquo;s
        NSS, Go&rsquo;s crypto/tls, Java&rsquo;s JSSE and OpenSSL all announce
        themselves clearly to anyone who bothers to look at the shape of the
        message rather than its contents.
      </p>
      <p className="lede">
        The schemes on this site are three different ways of reducing that shape
        to a string you can compare:{" "}
        <a href="/ja4/" className="text-canopy underline-offset-2 hover:underline">
          JA4
        </a>{" "}
        and{" "}
        <a href="/ja3/" className="text-canopy underline-offset-2 hover:underline">
          JA3
        </a>{" "}
        over the TLS handshake, and the{" "}
        <a
          href="/akamai/"
          className="text-canopy underline-offset-2 hover:underline"
        >
          Akamai HTTP/2 fingerprint
        </a>{" "}
        over the frames that follow it. Each has its own page here explaining how
        it is assembled and where it fails.
      </p>

      <h2 className="h2 mb-4 mt-12">Why your fingerprint might change</h2>
      <div className="space-y-4 text-base text-muted-foreground">
        <p>
          <strong className="font-semibold text-ink">GREASE.</strong> Clients
          deliberately advertise reserved values that mean nothing — RFC 8701 —
          to catch middleboxes that choke on anything unfamiliar. They are
          inserted at random positions and every fingerprinting scheme strips
          them before hashing. A tool that does not will give you a different
          answer every time and no explanation.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            Deliberate randomisation.
          </strong>{" "}
          Chrome permutes its TLS extension order on every connection, on
          purpose, so that the ordering cannot ossify into an interface that
          middleboxes depend on. This is what broke JA3 for browsers and what
          JA4 sorts around.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            Something in the path.
          </strong>{" "}
          Corporate TLS interception, a consumer anti-virus product, a VPN
          client or a debugging proxy will hand you the appliance&rsquo;s
          handshake rather than your own. If your fingerprint looks stable but
          unfamiliar, this is the first thing to rule out.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            You upgraded something.
          </strong>{" "}
          A patch release of a TLS library can move a fingerprint. That is
          usually fine and occasionally the entire point —{" "}
          <a
            href="/guides/ci-assertions/"
            className="text-canopy underline-offset-2 hover:underline"
          >
            pinning it in CI
          </a>{" "}
          turns a silent change into a failed build.
        </p>
      </div>

      <h2 className="h2 mb-4 mt-12">What it stores</h2>
      <p className="lede mb-4">
        Nothing. The fingerprint is computed from the live connection and
        written back out on that same connection. There is no database, no
        logging of handshakes, no account, and no key. Responses carry{" "}
        <C>no-store</C>, because a cached fingerprint would by definition belong
        to somebody else.
      </p>
      <p className="lede">
        The API is open to everything, rate limited only enough to stop it being
        used as a load generator.
      </p>
      <Code>{`curl -s https://kittens.sh/api/clean`}</Code>

      <h2 className="h2 mb-4 mt-12">Licensing and credit</h2>
      <p className="lede mb-4">
        JA3 is Salesforce&rsquo;s, from 2017, and JA4 is FoxIO&rsquo;s — both
        BSD-3-Clause, and both implemented here. The wider JA4+ suite (JA4S,
        JA4H, JA4X and the rest) is under the FoxIO License 1.1, which does not
        permit monetisation without an OEM licence, so none of it is implemented
        here. The HTTP/2 fingerprint follows Akamai&rsquo;s 2017 description of
        passive HTTP/2 client fingerprinting.
      </p>
      <p className="lede">
        The server is Rust, the site is a static export, and both are{" "}
        <a
          href="https://github.com/ctrl-cheeb-del/kittens"
          className="text-canopy underline-offset-2 hover:underline"
        >
          on GitHub
        </a>
        . Built by{" "}
        <a
          href="https://freebrey.art"
          className="text-canopy underline-offset-2 hover:underline"
        >
          Art Freebrey
        </a>
        , sponsored by{" "}
        <a
          href="https://revnu.com"
          className="text-canopy underline-offset-2 hover:underline"
        >
          Revnu
        </a>
        .
      </p>

      <h2 className="h2 mb-4 mt-12">Start here</h2>
      <p className="lede">
        <a href="/" className="text-canopy underline-offset-2 hover:underline">
          Inspect your own connection
        </a>
        , read the{" "}
        <a
          href="/docs/"
          className="text-canopy underline-offset-2 hover:underline"
        >
          API reference
        </a>
        , or start with{" "}
        <a href="/ja4/" className="text-canopy underline-offset-2 hover:underline">
          how JA4 is built
        </a>
        .
      </p>

      <JsonLd
        data={techArticle({ title: TITLE, description: DESCRIPTION, path: PATH })}
      />
    </Article>
  );
}
