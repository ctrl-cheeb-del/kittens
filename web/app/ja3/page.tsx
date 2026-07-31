import { Article, C, Code } from "@/components/Chrome";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata, techArticle } from "@/lib/seo";

const TITLE = "JA3: how it works and why it broke";
const DESCRIPTION =
  "The JA3 TLS fingerprint field by field, the MD5 that produces it, why Chrome's extension shuffling made it unstable in 2023, and where it is still worth using.";
const PATH = "/ja3/";

export const metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
});

const FIELDS: [string, string, string][] = [
  ["771", "TLS version", "The legacy client_version from the ClientHello. TLS 1.3 clients still write 771 (0x0303) here for compatibility, so this field rarely says anything useful any more"],
  ["4865-4866-…", "Cipher suites", "In the order offered, as decimals, GREASE removed"],
  ["0-23-65281-…", "Extensions", "In the order sent, as decimals, GREASE removed. This is the field that broke"],
  ["29-23-24", "Elliptic curves", "The supported_groups extension, in order"],
  ["0", "Point formats", "ec_point_formats. Almost universally just 0"],
];

export default function Ja3() {
  return (
    <Article>
      <h1 className="h1 mb-4">JA3</h1>
      <p className="lede mb-10">
        JA3 is the original TLS client fingerprint, published by Salesforce in
        2017 and named for the three engineers who wrote it. It is an MD5 over
        five fields of the ClientHello, taken in the order the client sent them.
        It is still everywhere, and it no longer identifies browsers.
      </p>

      <h2 className="h2 mb-4 mt-12">How it is built</h2>
      <p className="lede mb-4">
        Five fields, joined with commas. Within a field, values are joined with
        hyphens. Everything is decimal:
      </p>
      <Code>{`771,4865-4866-4867-49195-49199,0-23-65281-10-11-35-16-5-13,29-23-24,0

771                          TLS version
4865-4866-4867-49195-49199   cipher suites, in the order offered
0-23-65281-10-11-35-16-5-13  extensions, in the order sent
29-23-24                     elliptic curves
0                            point formats`}</Code>
      <p className="lede mb-4 mt-4">
        That string is hashed with MD5, and the 32-character result is the JA3.
        Both forms are worth having: <C>/api/ja3/full</C> returns the string,{" "}
        <C>/api/ja3</C> the hash. When two clients differ, only the string tells
        you where.
      </p>
      <div className="overflow-hidden rounded-2xl border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="label px-4 py-3 text-left">Field</th>
              <th className="label px-4 py-3 text-left">Source</th>
              <th className="label px-4 py-3 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(([example, field, notes]) => (
              <tr key={field} className="border-b border-line/60 last:border-b-0">
                <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-[12px] text-canopy">
                  {example}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 align-top">
                  {field}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="h2 mb-4 mt-12">GREASE</h2>
      <p className="lede">
        Clients deliberately advertise values that mean nothing — reserved
        codepoints such as <C>0x0a0a</C> and <C>0x1a1a</C>, defined by RFC 8701.
        Their purpose is to catch middleboxes that choke on anything they do not
        recognise, and they are inserted at random positions. Every fingerprint
        scheme strips them before hashing; a tool that does not will produce a
        different answer on every connection and be wrong about why.
      </p>

      <h2 className="h2 mb-4 mt-12">Why it broke</h2>
      <p className="lede mb-4">
        In 2023 Chrome began permuting the order of its TLS extensions on every
        connection. This was intentional: the ordering had become a de facto
        interface, middleboxes and servers had started depending on it, and
        randomising it keeps that dependency from ossifying.
      </p>
      <p className="lede mb-4">
        JA3 hashes the extension field in the order sent. Permute the order and
        the MD5 changes completely. One Chrome install now produces a different
        JA3 on every connection, so a JA3 blocklist entry for Chrome matches
        nothing, and a JA3 allowlist entry expires the moment it is written.
      </p>
      <p className="lede">
        <a href="/ja4/" className="text-canopy underline-offset-2 hover:underline">
          JA4
        </a>{" "}
        exists mainly to fix this. It sorts the cipher and extension lists before
        hashing, so a permutation cancels out.
      </p>

      <h2 className="h2 mb-4 mt-12">Where it still works</h2>
      <div className="space-y-4 text-base text-muted-foreground">
        <p>
          <strong className="font-semibold text-ink">Non-browser clients.</strong>{" "}
          Almost nothing outside the major browsers randomises. Python over
          OpenSSL, Go&rsquo;s crypto/tls, Java, curl, and most malware families
          emit a stable extension order, which means a stable JA3. For
          identifying scripted traffic it still works exactly as it did in 2017.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            Existing intelligence.
          </strong>{" "}
          A decade of threat feeds, IDS rules and incident reports are indexed by
          JA3 hash. That corpus does not disappear because browsers moved on, and
          matching against it needs a JA3.
        </p>
        <p>
          <strong className="font-semibold text-ink">Collisions cut both ways.</strong>{" "}
          JA3 was always coarse: any two applications sharing a TLS library and
          its defaults share a hash. That is a weakness when you want precision
          and a feature when you want to catch a family of tools at once.
        </p>
      </div>

      <h2 className="h2 mb-4 mt-12">JA3S</h2>
      <p className="lede">
        The server-side counterpart, hashing the ServerHello: version, the single
        chosen cipher, and the server&rsquo;s extensions. Paired with a client JA3
        it describes a conversation rather than a party, which is how it gets
        used to identify command-and-control channels. Not implemented here —
        this service is the server, so its own JA3S would be a constant.
      </p>

      <h2 className="h2 mb-4 mt-12">See your own</h2>
      <p className="lede">
        <C>curl -s https://kittens.sh/api/ja3/full</C> returns the unhashed
        string for whatever client you run it from, or{" "}
        <a href="/" className="text-canopy underline-offset-2 hover:underline">
          the inspector
        </a>{" "}
        shows every field it was assembled from, in wire order.
      </p>

      <JsonLd
        data={techArticle({ title: TITLE, description: DESCRIPTION, path: PATH })}
      />
    </Article>
  );
}
