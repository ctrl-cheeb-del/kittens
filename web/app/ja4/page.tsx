import { Article, C, Code } from "@/components/Chrome";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata, techArticle } from "@/lib/seo";

const TITLE = "JA4: the TLS client fingerprint, decoded";
const DESCRIPTION =
  "What a JA4 fingerprint is, how each of its three segments is built from the ClientHello, and how to read one. With a worked example and your own JA4.";
const PATH = "/ja4/";

export const metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
});

const SEGMENTS: [string, string, string][] = [
  ["t", "Transport", "t for TCP, q for QUIC, d for DTLS"],
  ["13", "TLS version", "The highest offered, from supported_versions if present. 13 is TLS 1.3"],
  ["d", "SNI", "d when the server name is a domain, i when the request went to a bare IP"],
  ["15", "Cipher count", "Cipher suites offered, GREASE excluded, capped at 99"],
  ["16", "Extension count", "Extensions sent, GREASE excluded, capped at 99. SNI and ALPN are counted here even though they are not hashed below"],
  ["h2", "ALPN", "First and last character of the first ALPN value. h2 stays h2; http/1.1 becomes h1; no ALPN is 00"],
];

export default function Ja4() {
  return (
    <Article>
      <h1 className="h1 mb-4">JA4</h1>
      <p className="lede mb-10">
        JA4 is a fingerprint of the TLS ClientHello, published by FoxIO as the
        successor to JA3. It identifies the TLS library on the other end of a
        connection, and unlike JA3 it survives clients that shuffle their
        extension order.
      </p>

      <h2 className="h2 mb-4 mt-12">The shape of one</h2>
      <p className="lede mb-4">
        Three underscore-separated segments, usually written{" "}
        <C>ja4_a _ ja4_b _ ja4_c</C>. Only the first is meant to be read by a
        human:
      </p>
      <Code>{`t13d1516h2_8daaf6152771_e5627efa2ab1

a   t13d1516h2    protocol, TLS version, SNI, counts, ALPN
b   8daaf6152771  sorted cipher suites, hashed
c   e5627efa2ab1  sorted extensions + signature algorithms, hashed`}</Code>

      <h2 className="h2 mb-4 mt-12">Segment a, character by character</h2>
      <p className="lede mb-4">
        Ten fixed-width characters. Taking <C>t13d1516h2</C> apart:
      </p>
      <div className="overflow-hidden rounded-2xl border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="label px-4 py-3 text-left">Chars</th>
              <th className="label px-4 py-3 text-left">Field</th>
              <th className="label px-4 py-3 text-left">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {SEGMENTS.map(([chars, field, meaning]) => (
              <tr key={field} className="border-b border-line/60 last:border-b-0">
                <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-[12px] text-canopy">
                  {chars}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 align-top">
                  {field}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lede mt-4">
        So <C>t13d1516h2</C> is: TLS over TCP, TLS 1.3, connecting to a domain
        name, offering 15 cipher suites and 16 extensions, negotiating HTTP/2.
        You can read that much without a lookup table, which is the point — JA3
        gave you a bare MD5 and nothing else.
      </p>

      <h2 className="h2 mb-4 mt-12">Segments b and c</h2>
      <p className="lede mb-4">
        Both are the first 12 hex characters of a SHA-256. Segment{" "}
        <strong className="font-semibold text-ink">b</strong> covers the cipher
        suites: GREASE values dropped, the remainder sorted ascending, written as
        four-digit hex and joined with commas.
      </p>
      <Code>{`002f,0035,009c,009d,1301,1302,1303,c02b,c02c,c02f,c030,cca8,cca9
    → sha256, first 12 hex chars → 8daaf6152771`}</Code>
      <p className="lede mb-4 mt-4">
        Segment <strong className="font-semibold text-ink">c</strong> covers the
        extensions, with three deletions: GREASE, SNI (<C>0x0000</C>) and ALPN (
        <C>0x0010</C>). SNI is removed because it varies with the site you are
        visiting rather than with your client, and ALPN because it is already
        spelled out in segment a. What is left is sorted, then the signature
        algorithms are appended after an underscore —{" "}
        <em>in the order they were sent</em>, not sorted, because that order is
        itself characteristic.
      </p>
      <Code>{`0005,000a,000b,000d,0012,0017,001b,0023,002b,002d,0033,44cd,ff01
_0403,0804,0401,0503,0805,0501,0806,0601
    → sha256, first 12 hex chars → e5627efa2ab1`}</Code>

      <h2 className="h2 mb-4 mt-12">Why sorting matters</h2>
      <p className="lede mb-4">
        In 2023 Chrome started permuting its TLS extension order on every
        connection, deliberately, to stop the ecosystem from depending on it.
        JA3 hashes extensions in the order sent, so a single Chrome install
        began producing a different JA3 every time — useless as an identifier
        and actively harmful as a blocklist entry.
      </p>
      <p className="lede">
        JA4 sorts before hashing, so the permutation cancels out and the same
        browser yields the same fingerprint. The cost is that JA4 cannot see
        ordering differences that are genuinely characteristic; the raw form
        below is there for when you need them.
      </p>

      <h2 className="h2 mb-4 mt-12">The raw form</h2>
      <p className="lede mb-4">
        Hashes are only useful for equality. When two clients differ and you
        need to know <em>where</em>, ask for the unhashed variant —{" "}
        <C>/api/ja4/raw</C> returns segment a unchanged with b and c expanded
        back into their lists, so a diff points at the cipher or extension that
        actually moved.
      </p>
      <Code>{`curl -s https://kittens.sh/api/ja4/raw`}</Code>

      <h2 className="h2 mb-4 mt-12">What it does and does not tell you</h2>
      <div className="space-y-4 text-base text-muted-foreground">
        <p>
          It identifies a <strong className="font-semibold text-ink">TLS
          stack and its configuration</strong> — Chrome&rsquo;s BoringSSL with
          Chrome&rsquo;s settings, Go&rsquo;s crypto/tls, Python over OpenSSL. It
          does not identify a person, a machine or a browser profile, and two
          different applications built on the same library with the same
          defaults will collide.
        </p>
        <p>
          It is also not a secret. Anything that controls its own handshake can
          choose what to send, which is what impersonation libraries do. A
          matching JA4 is evidence that a client is what it claims, not proof.
          Its real strength is the negative case: a client whose JA4 says one
          thing while its <a href="/guides/ua-mismatch/" className="text-canopy underline-offset-2 hover:underline">User-Agent says another</a>{" "}
          has told you something it did not mean to.
        </p>
      </div>

      <h2 className="h2 mb-4 mt-12">Licensing</h2>
      <p className="lede">
        JA4 itself is BSD-3-Clause. The rest of the JA4+ suite — JA4S, JA4H,
        JA4L, JA4X and the others — is under the FoxIO License 1.1, which does
        not permit monetisation without an OEM licence.
      </p>

      <h2 className="h2 mb-4 mt-12">See your own</h2>
      <p className="lede">
        <a href="/" className="text-canopy underline-offset-2 hover:underline">
          The inspector
        </a>{" "}
        shows your JA4 with every field it was built from, in wire order. Or{" "}
        <C>curl -s https://kittens.sh/api/ja4</C> from whatever client you want
        to measure. Next:{" "}
        <a href="/ja3/" className="text-canopy underline-offset-2 hover:underline">
          JA3
        </a>{" "}
        and the{" "}
        <a href="/akamai/" className="text-canopy underline-offset-2 hover:underline">
          Akamai HTTP/2 fingerprint
        </a>
        .
      </p>

      <JsonLd
        data={techArticle({ title: TITLE, description: DESCRIPTION, path: PATH })}
      />
    </Article>
  );
}
