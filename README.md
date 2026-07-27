# kittens

A Rust server that reports the TLS and HTTP fingerprint of whatever connects to
it. Live at **[kittens.sh](https://kittens.sh)**.

It terminates TLS itself, so it sees the ClientHello before anything parses it,
and speaks HTTP/2 directly so it keeps the frame ordering a normal library
discards.

## Features

- **JA3** and **JA4**, verified against FoxIO's published reference vector
- **Akamai** HTTP/2 fingerprint: SETTINGS in wire order, WINDOW_UPDATE,
  PRIORITY frames, pseudo-header order
- Full ClientHello decode: ciphers, extensions, groups, signature algorithms,
  key shares, ALPS, certificate compression, all in the order sent
- The **raw handshake bytes** with labelled byte ranges, for an annotated hex
  dump
- HTTP/1.1 header order with original casing preserved
- Client identification from handshake evidence, including when a User-Agent
  disagrees with the TLS stack behind it
- Automatic certificates via Let's Encrypt (TLS-ALPN-01)
- Serves its own static UI, so the page and the API share one connection

## API

No key, CORS open, rate limited per IP at 5 req/s with a burst of 60.

| Endpoint | Returns |
| --- | --- |
| `/api/all` | Everything, decoded |
| `/api/clean` | Just the hashes |
| `/api/tls` | ClientHello detail, including raw bytes and spans |
| `/api/http2` | SETTINGS, WINDOW_UPDATE, PRIORITY, pseudo-header order |
| `/api/http1` | HTTP/1.1 headers in wire order |
| `/api/ja3` | JA3 hash, plain text |
| `/api/ja3/full` | Unhashed JA3 string |
| `/api/ja4` | JA4 fingerprint, plain text |
| `/api/ja4/raw` | JA4 with both hash halves expanded |
| `/api/akamai` | Akamai fingerprint, plain text |
| `/api/ip` | Your IP |
| `/healthz` | Liveness |

Add `?pretty=0` for compact JSON.

```console
$ curl -s https://kittens.sh/api/clean
{
  "ja3_hash": "375c6162a492dfbf2795909110ce8424",
  "ja4": "t13d4907h2_0d8feac7bc37_7395dae3b2f3",
  "akamai_hash": "64a832f547be33249bf4d33e8a46c5dc",
  "user_agent": "curl/8.7.1"
}
```

Assert against it in CI to catch an impersonation library drifting from its
target:

```bash
[ "$(curl -s https://kittens.sh/api/ja4)" = "$EXPECTED" ] || exit 1
```

`/api/ja4/raw` leaves both hash halves expanded, so a diff points at the cipher
or extension that moved rather than just telling you the hash changed.

## Running

```bash
cd web && npm install && npm run build
cd ../server && KITTENS_STATIC_DIR=../web/out cargo run
```

Serves everything on `https://localhost:8443` with a self-signed certificate;
click through the browser warning once. Drop `KITTENS_STATIC_DIR` to run the
API alone.

```bash
cd server && cargo test
```

For UI work, `npm run dev` is faster. It runs on another port, so point it back
at the origin and accept the certificate at
`https://localhost:8443/api/all` first:

```bash
cd web && NEXT_PUBLIC_ORIGIN_URL=https://localhost:8443 npm run dev
```

## Deploying

```bash
fly apps create kittens
fly volumes create kittens_acme --size 1 --region lhr
fly deploy
fly ips list
```

Point A and AAAA records at the addresses it prints. The server must receive
the connection directly: anything that terminates TLS in front of it — a CDN,
a proxy, Cloudflare's orange cloud — makes every visitor see that intermediary's
fingerprint instead of their own, and nothing appears broken when it happens.
`handlers = []` in `fly.toml` is what keeps Fly passing raw TCP through.

`KITTENS_ACME_PROD` defaults to `0`, which uses the Let's Encrypt staging CA and
issues an untrusted certificate. Confirm issuance in `fly logs`, then
`fly secrets set KITTENS_ACME_PROD=1`. Production allows five duplicate
certificates a week.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `KITTENS_BIND` | `0.0.0.0:8443` | Listen address |
| `KITTENS_DOMAINS` | *(empty)* | Comma-separated. Empty means a self-signed dev certificate |
| `KITTENS_STATIC_DIR` | *(empty)* | Exported site. Empty means API only |
| `KITTENS_EMAIL` | *(empty)* | Optional ACME contact |
| `KITTENS_ACME_CACHE` | `/data/acme` | Certificate cache; must persist |
| `KITTENS_ACME_PROD` | `0` | `1` for the production CA |
| `KITTENS_LOG` | `info` | `tracing` filter |

## Layout

```
server/    Rust. ClientHello parser, HTTP/1.1 and HTTP/2, static file serving.
web/       Next.js, statically exported into the binary's image.
```

## Licence

MIT.

JA3 and JA4 are BSD-3-Clause. The rest of the JA4+ suite (JA4H, JA4S, JA4X and
so on) is FoxIO License 1.1, which prohibits monetisation without an OEM
licence, so none of it is implemented here.
