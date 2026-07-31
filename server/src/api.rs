//! Routing for the fingerprint API.
//!
//! Two shapes of consumer, deliberately served differently: `/api/all` is
//! exhaustive and pretty-printed for humans and the UI, while `/api/clean` and
//! the plain-text endpoints are terse enough to drop straight into a shell
//! pipeline or a CI assertion.

use crate::http::Response;
use crate::model::{self, Capture};
use crate::static_files::StaticSite;

/// Split "/api/all?pretty=0" into path and query.
fn split_query(target: &str) -> (&str, Option<&str>) {
    match target.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (target, None),
    }
}

/// Pretty by default — people read this in a terminal. `?pretty=0` opts out.
fn wants_pretty(query: Option<&str>) -> bool {
    let Some(q) = query else { return true };
    !q.split('&').any(|kv| matches!(kv, "pretty=0" | "pretty=false"))
}

fn json_response(value: &impl serde::Serialize, pretty: bool) -> Response {
    let body = if pretty {
        serde_json::to_vec_pretty(value)
    } else {
        serde_json::to_vec(value)
    };
    match body {
        Ok(mut b) => {
            if pretty {
                b.push(b'\n');
            }
            Response::json(200, b)
        }
        // Serialising our own types can't realistically fail, but a 500 beats
        // a panic that would take the connection down.
        Err(e) => Response::text(500, format!("serialisation failed: {e}")),
    }
}

/// True for paths this service answers itself. Everything else is the static
/// site's, so a future page can be added without touching the server.
fn is_api_path(path: &str) -> bool {
    let p = path.trim_end_matches('/');
    p.is_empty() || p == "/healthz" || p.starts_with("/api")
}

pub fn route(method: &str, target: &str, cap: &Capture) -> Response {
    route_with(method, target, cap, &StaticSite::new(None))
}

pub fn route_with(
    method: &str,
    target: &str,
    cap: &Capture,
    site: &StaticSite,
) -> Response {
    let (path, query) = split_query(target);
    let pretty = wants_pretty(query);

    // Browsers preflight the cross-origin fetch from kittens.sh.
    if method.eq_ignore_ascii_case("OPTIONS") {
        let mut r = Response::text(204, "");
        r.headers.push((
            "access-control-allow-methods".into(),
            "GET, HEAD, OPTIONS".into(),
        ));
        r.headers
            .push(("access-control-allow-headers".into(), "*".into()));
        r.headers.push(("access-control-max-age".into(), "86400".into()));
        r.body.clear();
        return r;
    }

    if !(method.eq_ignore_ascii_case("GET") || method.eq_ignore_ascii_case("HEAD")) {
        return Response::text(405, "method not allowed\n");
    }

    // Static assets are resolved before any fingerprinting work. A page load
    // pulls ~30 files, and hashing a ClientHello for each one would be pure
    // waste.
    if !is_api_path(path) {
        return site
            .canonical_redirect(path, query)
            .or_else(|| site.serve(path))
            .or_else(|| site.not_found())
            .unwrap_or_else(|| Response::text(404, "not found\n"));
    }

    // The apex belongs to the site when there is one; the JSON index is the
    // fallback for an API-only deployment.
    if path.trim_end_matches('/').is_empty() && site.is_available() {
        if let Some(r) = site.serve("/") {
            return r;
        }
    }

    let fp = model::build(cap);

    let mut resp = match path.trim_end_matches('/') {
        "" => json_response(&index_doc(), pretty),
        "/api/all" => json_response(&fp, pretty),
        "/api/clean" => json_response(&model::clean(&fp), pretty),
        "/api/tls" => json_response(&fp.tls, pretty),
        "/api/http2" => match &fp.http2 {
            Some(h) => json_response(h, pretty),
            None => Response::text(404, "connection is not HTTP/2\n"),
        },
        "/api/http1" => match &fp.http1 {
            Some(h) => json_response(h, pretty),
            None => Response::text(404, "connection is not HTTP/1.1\n"),
        },

        // Single values as bare text, for `curl -s .../api/ja4`.
        "/api/ja3" => Response::text(200, format!("{}\n", fp.ja3_hash)),
        "/api/ja3/full" => Response::text(200, format!("{}\n", fp.ja3)),
        "/api/ja4" => Response::text(200, format!("{}\n", fp.ja4)),
        "/api/ja4/raw" => Response::text(200, format!("{}\n", fp.ja4_r)),
        "/api/akamai" => match &fp.http2 {
            Some(h) => Response::text(200, format!("{}\n", h.akamai_fingerprint)),
            None => Response::text(404, "connection is not HTTP/2\n"),
        },
        "/api/ip" => Response::text(200, format!("{}\n", fp.ip)),

        // Cheap liveness check that skips fingerprinting entirely.
        "/healthz" => Response::text(200, "ok\n"),

        _ => Response::text(404, "not found — see https://kittens.sh/docs\n"),
    };

    // HEAD is GET without the body, but keeps content-length.
    if method.eq_ignore_ascii_case("HEAD") {
        resp.headers
            .push(("content-length".into(), resp.body.len().to_string()));
        resp.body.clear();
    }
    resp
}

/// Self-describing index so `curl https://tls.kittens.sh/` is useful on its own.
fn index_doc() -> serde_json::Value {
    serde_json::json!({
        "service": "kittens",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "TLS and HTTP fingerprinting. Everything is measured from \
                        your own connection to this host.",
        "endpoints": {
            "/api/all": "full fingerprint: TLS, HTTP/2, JA3, JA4",
            "/api/clean": "just the hashes",
            "/api/tls": "TLS ClientHello detail",
            "/api/http2": "HTTP/2 frames and Akamai fingerprint",
            "/api/http1": "HTTP/1.1 headers in wire order",
            "/api/ja3": "JA3 hash, plain text",
            "/api/ja3/full": "unhashed JA3 string",
            "/api/ja4": "JA4 fingerprint, plain text",
            "/api/ja4/raw": "JA4 with hash halves expanded",
            "/api/akamai": "Akamai HTTP/2 fingerprint, plain text",
            "/api/ip": "your IP",
            "/healthz": "liveness"
        },
        "options": {
            "?pretty=0": "compact JSON"
        },
        "docs": "https://kittens.sh/docs"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http1;
    use crate::tls::parse::{ClientHello, Extension};

    fn hello() -> ClientHello {
        ClientHello {
            legacy_version: 0x0303,
            cipher_suites: vec![0x1301, 0xc02b],
            extensions: vec![
                Extension {
                    typ: 0x0000,
                    data: vec![],
                },
                Extension {
                    typ: 0x002b,
                    data: vec![],
                },
            ],
            server_name: Some("tls.kittens.sh".into()),
            alpn: vec![b"http/1.1".to_vec()],
            supported_versions: vec![0x0304],
            signature_algorithms: vec![0x0403],
            ..Default::default()
        }
    }

    fn req(path: &str) -> http1::Request {
        http1::Request {
            method: "GET".into(),
            path: path.into(),
            version: "HTTP/1.1".into(),
            headers: vec![("User-Agent".into(), "curl/8.4.0".into())],
        }
    }

    fn call(method: &str, target: &str) -> Response {
        let h = hello();
        let r = req(target);
        let cap = Capture {
            hello: &h,
            negotiated_version: Some("TLS 1.3".into()),
            negotiated_cipher: None,
            negotiated_alpn: Some("http/1.1".into()),
            peer_ip: "198.51.100.9".into(),
            h2: None,
            h1: Some(&r),
        };
        route(method, target, &cap)
    }

    fn body_str(r: &Response) -> String {
        String::from_utf8_lossy(&r.body).to_string()
    }

    #[test]
    fn all_returns_valid_json() {
        let r = call("GET", "/api/all");
        assert_eq!(r.status, 200);
        let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
        assert!(v["ja4"].as_str().unwrap().starts_with("t13d"));
        assert_eq!(v["ip"], "198.51.100.9");
    }

    #[test]
    fn plain_text_endpoints_are_single_values() {
        let r = call("GET", "/api/ja4");
        assert_eq!(r.status, 200);
        let b = body_str(&r);
        assert!(b.ends_with('\n'));
        assert_eq!(b.trim().split_whitespace().count(), 1, "got: {b:?}");

        let r = call("GET", "/api/ja3");
        assert_eq!(body_str(&r).trim().len(), 32, "JA3 hash should be md5 hex");
    }

    #[test]
    fn pretty_is_default_and_can_be_disabled() {
        assert!(body_str(&call("GET", "/api/all")).contains("\n  "));
        let compact = body_str(&call("GET", "/api/all?pretty=0"));
        assert!(!compact.contains("\n  "), "pretty=0 should be compact");
        // Still valid JSON either way.
        serde_json::from_str::<serde_json::Value>(&compact).unwrap();
    }

    #[test]
    fn http2_endpoint_404s_on_an_h1_connection() {
        let r = call("GET", "/api/http2");
        assert_eq!(r.status, 404);
    }

    #[test]
    fn unknown_path_is_404() {
        assert_eq!(call("GET", "/nope").status, 404);
    }

    #[test]
    fn trailing_slash_is_tolerated() {
        assert_eq!(call("GET", "/api/all/").status, 200);
    }

    #[test]
    fn index_lists_endpoints() {
        let r = call("GET", "/");
        assert_eq!(r.status, 200);
        let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
        assert!(v["endpoints"]["/api/all"].is_string());
    }

    #[test]
    fn healthz_is_cheap_and_ok() {
        let r = call("GET", "/healthz");
        assert_eq!(r.status, 200);
        assert_eq!(body_str(&r), "ok\n");
    }

    #[test]
    fn cors_is_open_and_preflight_works() {
        let r = call("OPTIONS", "/api/all");
        assert_eq!(r.status, 204);
        assert!(r.body.is_empty());
        let allow = r
            .headers
            .iter()
            .find(|(k, _)| k == "access-control-allow-origin")
            .map(|(_, v)| v.clone());
        assert_eq!(allow.as_deref(), Some("*"));

        // The regular responses need it too — the UI fetches cross-origin.
        let r = call("GET", "/api/all");
        assert!(r
            .headers
            .iter()
            .any(|(k, v)| k == "access-control-allow-origin" && v == "*"));
    }

    #[test]
    fn responses_are_never_cached() {
        // A cached fingerprint would be served to the wrong visitor.
        for p in ["/api/all", "/api/clean", "/api/ja4", "/"] {
            let r = call("GET", p);
            assert!(
                r.headers
                    .iter()
                    .any(|(k, v)| k == "cache-control" && v.contains("no-store")),
                "{p} is missing no-store"
            );
        }
    }

    #[test]
    fn head_omits_body_but_keeps_length() {
        let get = call("GET", "/api/all");
        let head = call("HEAD", "/api/all");
        assert!(head.body.is_empty());
        let len = head
            .headers
            .iter()
            .find(|(k, _)| k == "content-length")
            .map(|(_, v)| v.parse::<usize>().unwrap());
        assert_eq!(len, Some(get.body.len()));
    }

    #[test]
    fn post_is_rejected() {
        assert_eq!(call("POST", "/api/all").status, 405);
    }
}
