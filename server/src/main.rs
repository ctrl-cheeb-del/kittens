//! kittens — TLS and HTTP fingerprinting server.
//!
//! Owns port 443 outright. That's the whole architectural constraint: every
//! managed platform terminates TLS before your code runs, and by then the
//! ClientHello is gone. So we read the handshake bytes ourselves, fingerprint
//! them, and only then hand the (replayed) stream to rustls.

mod api;
mod http;
mod http1;
mod http2;
mod model;
mod proxy_protocol;
mod ratelimit;
mod static_files;
mod stream;
mod tls;

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use rustls::ServerConfig;
use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;
use tracing::{debug, error, info, warn};

use crate::model::Capture;
use crate::ratelimit::{Limits, RateLimiter};
use crate::static_files::StaticSite;
use crate::stream::PrefixedStream;
use crate::tls::parse::{parse_from_records, ClientHello, ParseOutcome};

/// ALPN identifier for the TLS-ALPN-01 challenge (RFC 8737).
const ACME_TLS_ALPN: &[u8] = b"acme-tls/1";

/// A client that opens a connection and never completes its ClientHello would
/// otherwise hold a task forever.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
/// Total budget for one connection, keep-alive included.
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(120);
/// A ClientHello beyond this is not a real client.
const MAX_CLIENT_HELLO: usize = 64 * 1024;

struct Config {
    bind: String,
    /// Domains for Let's Encrypt. Empty means self-signed local dev.
    domains: Vec<String>,
    emails: Vec<String>,
    acme_cache: PathBuf,
    acme_production: bool,
    /// Directory of the exported site. Absent ⇒ API only.
    static_root: Option<PathBuf>,
    /// Expect a PROXY protocol header on every connection.
    ///
    /// Only enable where the listener is unreachable except through a trusted
    /// proxy: a client that can connect directly could otherwise name any
    /// source address it likes and walk past the rate limiter.
    proxy_protocol: bool,
}

impl Config {
    fn from_env() -> Config {
        let domains = std::env::var("KITTENS_DOMAINS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let emails = std::env::var("KITTENS_EMAIL")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Config {
            bind: std::env::var("KITTENS_BIND").unwrap_or_else(|_| "0.0.0.0:8443".into()),
            domains,
            emails,
            acme_cache: std::env::var("KITTENS_ACME_CACHE")
                .unwrap_or_else(|_| "/data/acme".into())
                .into(),
            // Default to the staging CA: hitting production rate limits while
            // iterating on a deploy is a multi-day mistake to undo.
            acme_production: std::env::var("KITTENS_ACME_PROD").as_deref() == Ok("1"),
            static_root: std::env::var("KITTENS_STATIC_DIR").ok().map(PathBuf::from),
            proxy_protocol: std::env::var("KITTENS_PROXY_PROTOCOL").as_deref() == Ok("1"),
        }
    }
}

/// Which rustls config a connection should use.
struct TlsConfigs {
    default: Arc<ServerConfig>,
    /// Present only under ACME; serves the TLS-ALPN-01 challenge certificate.
    challenge: Option<Arc<ServerConfig>>,
}

/// Shared per-connection state.
struct Shared {
    tls: TlsConfigs,
    limiter: RateLimiter,
    site: StaticSite,
    proxy_protocol: bool,
}

/// Apply the rate limit, then route. Liveness checks are exempt so a throttled
/// IP can't make the platform think the service is down.
fn respond(shared: &Shared, peer_ip: IpAddr, method: &str, target: &str, cap: &Capture) -> http::Response {
    let path = target.split('?').next().unwrap_or(target);
    if path != "/healthz" && !shared.limiter.allow(peer_ip) {
        let mut r = http::Response::text(429, "rate limited — slow down\n");
        r.headers.push(("retry-after".into(), "1".into()));
        return r;
    }
    api::route_with(method, target, cap, &shared.site)
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("KITTENS_LOG")
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    // rustls needs a process-wide crypto provider before any config is built.
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("failed to install ring crypto provider"))?;

    let cfg = Config::from_env();
    let configs = if cfg.domains.is_empty() {
        info!("no KITTENS_DOMAINS set — using a self-signed certificate (local dev)");
        TlsConfigs {
            default: self_signed_config()?,
            challenge: None,
        }
    } else {
        info!(
            domains = ?cfg.domains,
            production = cfg.acme_production,
            "requesting certificates via ACME TLS-ALPN-01"
        );
        acme_configs(&cfg)?
    };
    let site = StaticSite::new(cfg.static_root.clone());
    if site.is_available() {
        info!(dir = ?cfg.static_root, "serving the static site alongside the API");
    } else {
        info!("no static site found — serving the API only");
    }

    if cfg.proxy_protocol {
        info!("expecting a PROXY protocol header on every connection");
    }

    let shared = Arc::new(Shared {
        tls: configs,
        limiter: RateLimiter::new(Limits::default()),
        site,
        proxy_protocol: cfg.proxy_protocol,
    });

    let listener = TcpListener::bind(&cfg.bind)
        .await
        .with_context(|| format!("binding {}", cfg.bind))?;
    info!(bind = %cfg.bind, "kittens listening");

    loop {
        let (tcp, peer) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => {
                // Per-accept errors (fd exhaustion, RST) must not kill the loop.
                warn!(error = %e, "accept failed");
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
        };
        let shared = shared.clone();
        tokio::spawn(async move {
            let r = tokio::time::timeout(CONNECTION_TIMEOUT, handle(tcp, peer, shared)).await;
            match r {
                Ok(Ok(())) => {}
                // Nearly all of these are ordinary: scanners, aborted loads,
                // clients that hang up mid-handshake. Debug, not warn.
                Ok(Err(e)) => debug!(%peer, error = %e, "connection ended"),
                Err(_) => debug!(%peer, "connection timed out"),
            }
        });
    }
}

async fn handle(mut tcp: TcpStream, peer: SocketAddr, shared: Arc<Shared>) -> Result<()> {
    // Disable Nagle: our replies are a single small write and latency is the
    // only thing a visitor notices.
    let _ = tcp.set_nodelay(true);

    // Anything already read past the PROXY header belongs to the handshake.
    let mut carried = Vec::new();
    let mut peer = peer;

    if shared.proxy_protocol {
        let header = tokio::time::timeout(
            HANDSHAKE_TIMEOUT,
            proxy_protocol::read(&mut tcp, &mut carried),
        )
        .await
        .context("timed out reading PROXY header")??;

        // LOCAL headers (the platform's own health checks) carry no client, so
        // the socket address is the best we have.
        if let Some(source) = header.source {
            peer = source;
        }
    }

    let (hello, raw) = tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        read_client_hello(&mut tcp, carried),
    )
    .await
    .context("timed out reading ClientHello")??;

    // An ACME validation request is just a ClientHello advertising acme-tls/1;
    // we already parsed the ALPN list, so no second parse is needed.
    let is_acme_challenge = hello.alpn.iter().any(|p| p == ACME_TLS_ALPN);

    let config = if is_acme_challenge {
        match &shared.tls.challenge {
            Some(c) => {
                info!(%peer, "serving TLS-ALPN-01 challenge");
                c.clone()
            }
            None => bail!("ACME challenge received but ACME is not configured"),
        }
    } else {
        shared.tls.default.clone()
    };

    let acceptor = TlsAcceptor::from(config);
    let mut tls = acceptor
        .accept(PrefixedStream::new(raw, tcp))
        .await
        .context("TLS handshake failed")?;

    // The challenge connection exists only to prove control of the name.
    if is_acme_challenge {
        use tokio::io::AsyncWriteExt;
        let _ = tls.shutdown().await;
        return Ok(());
    }

    let (negotiated_alpn, negotiated_version, negotiated_cipher) = {
        let (_, conn) = tls.get_ref();
        (
            conn.alpn_protocol()
                .map(|p| String::from_utf8_lossy(p).to_string()),
            conn.protocol_version().map(|v| format!("{v:?}")),
            conn.negotiated_cipher_suite()
                .map(|c| format!("{:?}", c.suite())),
        )
    };

    let peer_ip = peer.ip().to_string();
    debug!(%peer, alpn = ?negotiated_alpn, "handshake complete");

    if negotiated_alpn.as_deref() == Some("h2") {
        http2::conn::serve(&mut tls, |req, obs| {
            let cap = Capture {
                hello: &hello,
                negotiated_version: negotiated_version.clone(),
                negotiated_cipher: negotiated_cipher.clone(),
                negotiated_alpn: negotiated_alpn.clone(),
                peer_ip: peer_ip.clone(),
                h2: Some((obs, &req.headers)),
                h1: None,
            };
            respond(&shared, peer.ip(), req.method(), req.path(), &cap)
        })
        .await
    } else {
        http1::serve(&mut tls, |req| {
            let cap = Capture {
                hello: &hello,
                negotiated_version: negotiated_version.clone(),
                negotiated_cipher: negotiated_cipher.clone(),
                negotiated_alpn: negotiated_alpn.clone(),
                peer_ip: peer_ip.clone(),
                h2: None,
                h1: Some(req),
            };
            respond(&shared, peer.ip(), &req.method, &req.path, &cap)
        })
        .await
    }
}

/// Read from the socket until a complete ClientHello has arrived, returning it
/// alongside the raw bytes so they can be replayed to rustls.
async fn read_client_hello(
    tcp: &mut TcpStream,
    carried: Vec<u8>,
) -> Result<(ClientHello, Vec<u8>)> {
    // Whatever arrived alongside the PROXY header is already handshake bytes,
    // and may even be a complete hello, so parse before reading again.
    let mut acc = carried;
    acc.reserve(4096);
    let mut chunk = [0u8; 4096];

    loop {
        match parse_from_records(&acc)? {
            ParseOutcome::Complete(hello) => return Ok((*hello, acc)),
            ParseOutcome::NeedMore => {
                if acc.len() > MAX_CLIENT_HELLO {
                    bail!("ClientHello exceeds {MAX_CLIENT_HELLO} bytes");
                }
            }
        }

        let n = tcp.read(&mut chunk).await?;
        if n == 0 {
            bail!("connection closed before ClientHello completed");
        }
        acc.extend_from_slice(&chunk[..n]);
    }
}

fn alpn_protocols() -> Vec<Vec<u8>> {
    vec![b"h2".to_vec(), b"http/1.1".to_vec()]
}

/// Local development certificate. Browsers will warn; that's expected and does
/// not affect the fingerprint, which is taken before the certificate matters.
fn self_signed_config() -> Result<Arc<ServerConfig>> {
    let cert = rcgen::generate_simple_self_signed(vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
    ])
    .context("generating self-signed certificate")?;

    let cert_der = cert.cert.der().clone();
    let key_der = rustls::pki_types::PrivateKeyDer::try_from(cert.signing_key.serialize_der())
        .map_err(|e| anyhow::anyhow!("encoding private key: {e}"))?;

    let mut config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)
        .context("building self-signed TLS config")?;
    config.alpn_protocols = alpn_protocols();
    Ok(Arc::new(config))
}

/// Let's Encrypt via TLS-ALPN-01, which needs only port 443 — no port 80, no
/// DNS API credentials.
fn acme_configs(cfg: &Config) -> Result<TlsConfigs> {
    use rustls_acme::caches::DirCache;
    use rustls_acme::AcmeConfig;

    if cfg.emails.is_empty() {
        warn!("KITTENS_EMAIL is unset; Let's Encrypt will not be able to reach you");
    }

    let mut state = AcmeConfig::new(cfg.domains.clone())
        .contact(cfg.emails.iter().map(|e| format!("mailto:{e}")))
        .cache(DirCache::new(cfg.acme_cache.clone()))
        .directory_lets_encrypt(cfg.acme_production)
        .state();

    let challenge = state.challenge_rustls_config();
    let resolver = state.resolver();

    // Certificate issuance and renewal only progress while this stream is
    // polled — the crate spawns nothing itself.
    tokio::spawn(async move {
        use tokio_stream::StreamExt;
        loop {
            match state.next().await {
                Some(Ok(ok)) => info!("acme: {ok:?}"),
                Some(Err(e)) => error!("acme error: {e:?}"),
                None => {
                    error!("acme state stream ended; certificates will not renew");
                    return;
                }
            }
        }
    });

    let mut default = ServerConfig::builder()
        .with_no_client_auth()
        .with_cert_resolver(resolver);
    default.alpn_protocols = alpn_protocols();

    Ok(TlsConfigs {
        default: Arc::new(default),
        challenge: Some(challenge),
    })
}
