import { Article, C, Code } from "@/components/Chrome";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata, techArticle } from "@/lib/seo";

const TITLE = "The Akamai HTTP/2 fingerprint";
const DESCRIPTION =
  "How the Akamai HTTP/2 fingerprint is assembled from SETTINGS, WINDOW_UPDATE, PRIORITY frames and pseudo-header order — and why it catches clients that got their TLS right.";
const PATH = "/akamai/";

export const metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
});

const PARTS: [string, string, string][] = [
  [
    "SETTINGS",
    "1:65536;2:0;4:6291456;6:262144",
    "Every setting in the client's SETTINGS frame as id:value, joined with semicolons, in the order sent. Which settings a client bothers to send, and which it leaves at the default, is as characteristic as the values",
  ],
  [
    "WINDOW_UPDATE",
    "15663105",
    "The increment on the connection-level WINDOW_UPDATE, if the client sends one. 00 when it does not",
  ],
  [
    "PRIORITY",
    "0",
    "Each PRIORITY frame as streamId:exclusive:dependsOn:weight, joined with commas. 0 when there are none. Firefox builds an elaborate priority tree here; most clients send nothing",
  ],
  [
    "Pseudo-headers",
    "m,a,s,p",
    "The order of :method, :authority, :scheme and :path in the first request, as first letters. Chrome sends m,a,s,p; Firefox sends m,p,a,s",
  ],
];

export default function Akamai() {
  return (
    <Article>
      <h1 className="h1 mb-4">The Akamai HTTP/2 fingerprint</h1>
      <p className="lede mb-10">
        A fingerprint that ignores TLS entirely. It reads the first few frames of
        an HTTP/2 connection — how the client configures the session, how it
        manages flow control, and the order it writes its pseudo-headers — and
        those choices identify the HTTP library as reliably as a ClientHello
        identifies the TLS one. Described by Akamai in a 2017 paper on passive
        HTTP/2 client fingerprinting.
      </p>

      <h2 className="h2 mb-4 mt-12">The format</h2>
      <p className="lede mb-4">
        Four fields separated by pipes:
      </p>
      <Code>{`1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p

1:65536;2:0;4:6291456;6:262144  SETTINGS, in the order sent
15663105                        connection-level WINDOW_UPDATE
0                               PRIORITY frames (none here)
m,a,s,p                         pseudo-header order`}</Code>

      <div className="mt-6 space-y-6">
        {PARTS.map(([name, example, desc]) => (
          <div key={name}>
            <h3 className="mb-1 font-display text-lg font-bold tracking-tight">
              {name}
            </h3>
            <p className="mb-1.5 font-mono text-[12px] text-canopy">{example}</p>
            <p className="text-base text-muted-foreground text-pretty">{desc}</p>
          </div>
        ))}
      </div>

      <h2 className="h2 mb-4 mt-12">Why it catches people</h2>
      <p className="lede mb-4">
        It sits at a different layer from JA3 and JA4, and almost nobody thinks
        about it. A client can be made to produce a perfect Chrome ClientHello —
        that is a solved problem, several libraries do it — and still announce
        itself immediately afterwards by sending four SETTINGS where Chrome sends
        five, or by writing <C>:path</C> before <C>:authority</C>.
      </p>
      <p className="lede mb-4">
        The pseudo-header order is the cleanest example. HTTP/2 requires the
        pseudo-headers to precede regular headers and forbids duplicates, but it
        does not fix their relative order, so each implementation just writes
        them in whatever order its code happens to. That order is stable per
        library and effectively invisible unless you are looking for it.
      </p>
      <p className="lede">
        Flow control gives away as much. The connection-level WINDOW_UPDATE
        increment is a tuning constant chosen by whoever wrote the client, and
        the values in the wild cluster tightly by implementation.
      </p>

      <h2 className="h2 mb-4 mt-12">What breaks it</h2>
      <div className="space-y-4 text-base text-muted-foreground">
        <p>
          <strong className="font-semibold text-ink">
            Anything that re-frames the connection.
          </strong>{" "}
          A proxy, a CDN or a load balancer that terminates HTTP/2 and re-emits
          it will substitute its own SETTINGS and frame ordering, so what the
          origin measures is the proxy. This service terminates TLS and speaks
          HTTP/2 itself for exactly that reason.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            Connection reuse.
          </strong>{" "}
          SETTINGS and the connection WINDOW_UPDATE appear once per connection,
          not once per request. A fingerprint taken from a reused connection
          describes the connection&rsquo;s opener.
        </p>
        <p>
          <strong className="font-semibold text-ink">HTTP/1.1.</strong> There are
          no frames to read. For an HTTP/1.1 client the equivalent signal is
          header order and original casing, which{" "}
          <C>/api/http1</C> returns as sent.
        </p>
      </div>

      <h2 className="h2 mb-4 mt-12">See your own</h2>
      <p className="lede">
        <C>curl -s https://kittens.sh/api/akamai</C> returns the fingerprint
        string as plain text; <C>/api/http2</C> returns the frames it was built
        from, in wire order, so you can see which setting differs rather than
        just that the hash does. Related:{" "}
        <a href="/ja4/" className="text-canopy underline-offset-2 hover:underline">
          JA4
        </a>{" "}
        and{" "}
        <a href="/ja3/" className="text-canopy underline-offset-2 hover:underline">
          JA3
        </a>{" "}
        for the TLS layer.
      </p>

      <JsonLd
        data={techArticle({ title: TITLE, description: DESCRIPTION, path: PATH })}
      />
    </Article>
  );
}
