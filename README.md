# kittens

TLS and HTTP fingerprinting. Shows you the JA3, JA4 and Akamai HTTP/2
fingerprint your client sends, decoded field by field.

Everything lives on one host: `kittens.sh` serves both the site and the API.

```
kittens.sh          site + API, one Fly app, owns :443
tls.kittens.sh      alias for the same app
```

## Why it can't run on Vercel or Railway

Every managed platform — Vercel, Railway, Cloudflare Pages, Netlify — terminates
TLS before your code runs. By the time a request reaches a handler the
ClientHello is gone, and the ClientHello *is* the fingerprint. Cloudflare can
expose `ja3Hash`/`ja4` via `request.cf.botManagement`, but only on Enterprise
Bot Management, and only as opaque hashes with no HTTP/2 frame detail.

So the server has to own port 443 outright. On Fly that means `handlers = []`
in `fly.toml`, which passes raw TCP straight through. **Adding `"tls"` to that
list would make Fly terminate the handshake and every visitor would fingerprint
Fly's proxy instead of their own browser.** That one line is load-bearing.

For the same reason `kittens.sh` can never sit behind Cloudflare's orange cloud,
or any CDN. Proxying it silently breaks the entire product — the site would keep
working and just report the wrong answer.

## One host, on purpose

The site is fully static, so the Rust binary serves it directly. That means:

- `curl kittens.sh/api/all` works, which is what people actually type
- the fetch is same-origin, so no CORS and no second TLS connection
- the fingerprint shown is measured from the very connection that loaded the
  page

The measurement still happens **client-side**. Anything server-rendered would
fingerprint the build machine rather than the visitor.

## Layout

```
server/    Rust. Parses the ClientHello, speaks HTTP/1.1 and HTTP/2, serves the site.
web/       Next.js, statically exported to web/out.
Dockerfile Builds both into one image.
```

## Running locally

```bash
# Build the site once, then let the server serve everything on :8443.
cd web && npm install && npm run build
cd ../server && KITTENS_STATIC_DIR=../web/out cargo run
```

Open <https://localhost:8443>. The dev certificate is self-signed, so click
through the browser warning once — same-origin means there is only one
certificate to accept.

For iterating on the UI, `next dev` is faster. It runs on a different port, so
point it back at the origin explicitly:

```bash
cd web && NEXT_PUBLIC_ORIGIN_URL=https://localhost:8443 npm run dev
```

That path is cross-origin, so accept the certificate at
<https://localhost:8443/api/all> first or the fetch is blocked silently.

```bash
cd server && cargo test          # 89 tests
curl -sk https://localhost:8443/api/clean
```

## How it works

**TLS.** rustls deliberately hides the extension list's wire order, and order is
the entire basis of JA3/JA4. So `tls/parse.rs` reads the handshake bytes off the
socket and parses the ClientHello by hand, then `stream.rs` replays those same
bytes to rustls so the real handshake can proceed. No forking, no double parse.

**HTTP/2.** The Akamai fingerprint needs SETTINGS *in the order sent*, the
connection WINDOW_UPDATE, PRIORITY frames, and pseudo-header order. Every HTTP/2
library discards all four on the way to handing you a parsed request. Since this
endpoint only ever answers small GETs, `http2/conn.rs` implements the protocol
directly — less code than recovering that state from `h2`.

**HTTP/1.1.** Header names are taken verbatim from httparse. `User-Agent` vs
`user-agent` is itself a signal and normalising it would destroy information.

**Static files.** `static_files.rs` serves `web/out`. Content-hashed assets
under `/_next/static` are immutable-cached; HTML is `no-cache` so a deploy can't
leave stale pages pointing at chunks that no longer exist.

## Correctness

The JA4 implementation is checked against FoxIO's own published worked example
(`tls/ja4.rs::foxio_reference_vector`) — both the fingerprint and the unhashed
`ja4_r` form must match byte for byte. JA3 is checked against the canonical
Salesforce vector. curl's Akamai fingerprint reproduces the known public value.

Also covered: a fuzz-lite pass asserting no truncation or byte flip of a
ClientHello can panic the parser, and path-traversal tests on the static server.

## Deploying

```bash
fly launch --no-deploy --name kittens          # or: fly apps create kittens
fly volumes create kittens_acme --size 1 --region lhr
fly secrets set KITTENS_EMAIL=you@example.com
fly deploy
fly ips list
```

Point DNS at the addresses from `fly ips list`:

| Record | Name | Value |
|---|---|---|
| A | `kittens.sh` | Fly IPv4 |
| AAAA | `kittens.sh` | Fly IPv6 |
| CNAME | `www` | `kittens.sh` |
| CNAME | `tls` | `kittens.sh` |

If DNS is hosted at Cloudflare, every one of these must be **grey-clouded /
DNS-only**.

`fly.toml` ships with `KITTENS_ACME_PROD = "0"`, which uses Let's Encrypt
**staging** — the certificate will not be publicly trusted. Confirm issuance
works first (`fly logs` shows an `acme:` event), then:

```bash
fly secrets set KITTENS_ACME_PROD=1
```

Staging first is deliberate. Production allows five duplicate certificates per
week, and burning that quota while debugging a deploy costs days.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `KITTENS_BIND` | `0.0.0.0:8443` | Listen address |
| `KITTENS_DOMAINS` | *(empty)* | Comma-separated. Empty ⇒ self-signed dev cert |
| `KITTENS_STATIC_DIR` | *(empty)* | Exported site. Empty ⇒ API only |
| `KITTENS_EMAIL` | *(empty)* | Let's Encrypt contact |
| `KITTENS_ACME_CACHE` | `/data/acme` | Certificate cache; must persist |
| `KITTENS_ACME_PROD` | `0` | `1` for the production CA |
| `KITTENS_LOG` | `info` | `tracing` filter |

## API

Documented at `/docs`. Highlights:

| Path | Returns |
|---|---|
| `/api/all` | Everything, decoded |
| `/api/clean` | Just the hashes |
| `/api/ja4` | JA4, plain text |
| `/api/ja4/raw` | JA4 with hash halves expanded, for diffing |
| `/api/akamai` | Akamai HTTP/2 fingerprint, plain text |

Rate limited per IP (5 req/s sustained, 60 burst). `/healthz` is exempt.

## Licensing

JA3 and JA4 are both BSD-3-Clause. The wider JA4+ suite (JA4H, JA4S, JA4X…) is
FoxIO License 1.1, which prohibits monetisation without an OEM licence — none of
it is implemented here, so putting a paid tier on this API stays clean.
