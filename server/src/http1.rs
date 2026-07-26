//! HTTP/1.1, kept deliberately literal.
//!
//! httparse is used only to find the message boundary and split fields; we take
//! header names straight from its output so original casing and wire order
//! survive. `User-Agent` vs `user-agent` vs `USER-AGENT` is itself a signal, and
//! any normalising client library would erase it.

use anyhow::{bail, Context, Result};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::http::Response;

/// Most clients send well under 8 KB of headers; anything past this is abuse.
const MAX_HEADER_BYTES: usize = 32 * 1024;
const MAX_HEADERS: usize = 128;

#[derive(Debug, Clone, Default)]
pub struct Request {
    pub method: String,
    pub path: String,
    /// "HTTP/1.0" or "HTTP/1.1".
    pub version: String,
    /// Headers in wire order with original casing preserved.
    pub headers: Vec<(String, String)>,
}

impl Request {
    pub fn get(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    /// Header names in wire order — the part that's actually fingerprintable.
    pub fn header_order(&self) -> Vec<String> {
        self.headers.iter().map(|(k, _)| k.clone()).collect()
    }

    fn wants_keep_alive(&self) -> bool {
        match self.get("connection") {
            Some(v) if v.eq_ignore_ascii_case("close") => false,
            Some(v) if v.eq_ignore_ascii_case("keep-alive") => true,
            // Default differs by version.
            _ => self.version != "HTTP/1.0",
        }
    }
}

/// Bodies are read and discarded; this caps how much we'll swallow.
const MAX_BODY_BYTES: usize = 1024 * 1024;

/// Read one request, using and updating a connection-lifetime buffer.
///
/// The buffer must persist across calls. Two requests routinely arrive in a
/// single TCP read — via pipelining, or just segment coalescing — and anything
/// past the first request's terminator belongs to the next one. Parsing into a
/// fresh buffer each call would silently drop it and then block forever waiting
/// for a request that already arrived.
///
/// Returns None on a clean connection close.
pub async fn read_request<S: AsyncRead + Unpin>(
    stream: &mut S,
    buf: &mut Vec<u8>,
) -> Result<Option<Request>> {
    loop {
        // Always try what's already buffered before going back to the socket.
        if !buf.is_empty() {
            // Scoped so the borrow of `buf` ends before we drain it.
            let parsed: Option<(Request, usize)> = {
                let mut headers = [httparse::EMPTY_HEADER; MAX_HEADERS];
                let mut req = httparse::Request::new(&mut headers);
                match req.parse(buf).context("malformed HTTP/1 request")? {
                    httparse::Status::Partial => None,
                    httparse::Status::Complete(n) => {
                        let version = match req.version {
                            Some(0) => "HTTP/1.0",
                            _ => "HTTP/1.1",
                        };
                        let request = Request {
                            method: req.method.unwrap_or("GET").to_string(),
                            path: req.path.unwrap_or("/").to_string(),
                            version: version.to_string(),
                            headers: req
                                .headers
                                .iter()
                                .map(|h| {
                                    (
                                        // httparse hands back the name exactly
                                        // as it appeared; do not normalise it.
                                        h.name.to_string(),
                                        String::from_utf8_lossy(h.value).to_string(),
                                    )
                                })
                                .collect(),
                        };
                        Some((request, n))
                    }
                }
            };

            if let Some((request, consumed)) = parsed {
                buf.drain(..consumed);
                // A body isn't meaningful to this service, but it has to come
                // off the wire or it'd be misread as the next request.
                discard_body(stream, buf, &request).await?;
                return Ok(Some(request));
            }
        }

        if buf.len() > MAX_HEADER_BYTES {
            bail!("request headers exceed {MAX_HEADER_BYTES} bytes");
        }

        let mut chunk = [0u8; 2048];
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            // EOF with nothing buffered is a normal close.
            if buf.is_empty() {
                return Ok(None);
            }
            bail!("connection closed mid-request");
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

/// Consume `Content-Length` bytes so the buffer is left at the next request.
async fn discard_body<S: AsyncRead + Unpin>(
    stream: &mut S,
    buf: &mut Vec<u8>,
    req: &Request,
) -> Result<()> {
    let Some(len) = req
        .get("content-length")
        .and_then(|v| v.trim().parse::<usize>().ok())
    else {
        return Ok(());
    };
    if len == 0 {
        return Ok(());
    }
    if len > MAX_BODY_BYTES {
        bail!("request body exceeds {MAX_BODY_BYTES} bytes");
    }

    let already = buf.len().min(len);
    buf.drain(..already);
    let mut remaining = len - already;

    let mut chunk = [0u8; 4096];
    while remaining > 0 {
        let want = remaining.min(chunk.len());
        let n = stream.read(&mut chunk[..want]).await?;
        if n == 0 {
            bail!("connection closed mid-body");
        }
        remaining -= n;
    }
    Ok(())
}

pub async fn write_response<S: AsyncWrite + Unpin>(
    stream: &mut S,
    resp: &Response,
    keep_alive: bool,
) -> Result<()> {
    let mut out = Vec::with_capacity(256 + resp.body.len());
    out.extend_from_slice(
        format!("HTTP/1.1 {} {}\r\n", resp.status, resp.status_text()).as_bytes(),
    );
    for (k, v) in &resp.headers {
        out.extend_from_slice(format!("{k}: {v}\r\n").as_bytes());
    }
    out.extend_from_slice(format!("content-length: {}\r\n", resp.body.len()).as_bytes());
    out.extend_from_slice(
        if keep_alive {
            "connection: keep-alive\r\n"
        } else {
            "connection: close\r\n"
        }
        .as_bytes(),
    );
    out.extend_from_slice(b"\r\n");
    out.extend_from_slice(&resp.body);

    stream.write_all(&out).await?;
    stream.flush().await?;
    Ok(())
}

/// Serve requests until the client goes away or asks to close.
pub async fn serve<S, F>(stream: &mut S, mut respond: F) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
    F: FnMut(&Request) -> Response,
{
    // One buffer for the life of the connection — see read_request.
    let mut buf = Vec::with_capacity(2048);
    loop {
        let Some(req) = read_request(stream, &mut buf).await? else {
            return Ok(());
        };
        let keep_alive = req.wants_keep_alive();
        let resp = respond(&req);
        write_response(stream, &resp, keep_alive).await?;
        if !keep_alive {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[tokio::test]
    async fn preserves_header_order_and_casing() {
        let raw = b"GET /api/all HTTP/1.1\r\n\
                    Host: tls.kittens.sh\r\n\
                    User-Agent: curl/8.4.0\r\n\
                    ACCEPT: */*\r\n\
                    x-lower: 1\r\n\r\n";
        let mut cur = Cursor::new(raw.to_vec());
        let mut buf = Vec::new();
        let req = read_request(&mut cur, &mut buf).await.unwrap().unwrap();

        assert_eq!(req.method, "GET");
        assert_eq!(req.path, "/api/all");
        assert_eq!(req.version, "HTTP/1.1");
        assert_eq!(
            req.header_order(),
            vec!["Host", "User-Agent", "ACCEPT", "x-lower"],
            "original casing and order must survive"
        );
        assert_eq!(req.get("user-agent"), Some("curl/8.4.0"));
    }

    #[tokio::test]
    async fn handles_request_split_across_reads() {
        // Simulate a client that dribbles the request out in fragments.
        let (client, mut server) = tokio::io::duplex(1024);
        let (_rx, mut tx) = tokio::io::split(client);

        tokio::spawn(async move {
            for part in [
                "GET / HTTP/1.1\r\n".as_bytes(),
                "Host: kittens.sh\r\n".as_bytes(),
                "\r\n".as_bytes(),
            ] {
                tx.write_all(part).await.unwrap();
                tx.flush().await.unwrap();
                tokio::task::yield_now().await;
            }
        });

        let mut buf = Vec::new();
        let req = read_request(&mut server, &mut buf).await.unwrap().unwrap();
        assert_eq!(req.get("host"), Some("kittens.sh"));
    }

    #[tokio::test]
    async fn clean_eof_returns_none() {
        let mut cur = Cursor::new(Vec::new());
        let mut buf = Vec::new();
        assert!(read_request(&mut cur, &mut buf).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn oversized_headers_rejected() {
        let mut raw = b"GET / HTTP/1.1\r\n".to_vec();
        for i in 0..5000 {
            raw.extend_from_slice(format!("x-pad-{i}: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\n").as_bytes());
        }
        let mut cur = Cursor::new(raw);
        let mut buf = Vec::new();
        assert!(read_request(&mut cur, &mut buf).await.is_err());
    }

    /// Regression: two requests arriving in one read must both be seen.
    /// Parsing into a fresh buffer per call dropped the second and hung.
    #[tokio::test]
    async fn pipelined_requests_in_one_read() {
        let raw = b"GET /first HTTP/1.1\r\nHost: k\r\n\r\n\
                    GET /second HTTP/1.1\r\nHost: k\r\n\r\n";
        let mut cur = Cursor::new(raw.to_vec());
        let mut buf = Vec::new();

        let a = read_request(&mut cur, &mut buf).await.unwrap().unwrap();
        assert_eq!(a.path, "/first");
        let b = read_request(&mut cur, &mut buf).await.unwrap().unwrap();
        assert_eq!(b.path, "/second");
        assert!(read_request(&mut cur, &mut buf).await.unwrap().is_none());
    }

    /// A body must be consumed, or its bytes get parsed as the next request.
    #[tokio::test]
    async fn body_is_consumed_before_next_request() {
        let raw = b"POST /p HTTP/1.1\r\nHost: k\r\nContent-Length: 5\r\n\r\nHELLO\
                    GET /after HTTP/1.1\r\nHost: k\r\n\r\n";
        let mut cur = Cursor::new(raw.to_vec());
        let mut buf = Vec::new();

        let a = read_request(&mut cur, &mut buf).await.unwrap().unwrap();
        assert_eq!(a.method, "POST");
        let b = read_request(&mut cur, &mut buf).await.unwrap().unwrap();
        assert_eq!(b.path, "/after", "body leaked into the next request");
    }

    #[test]
    fn keep_alive_defaults_by_version() {
        let mut r = Request {
            version: "HTTP/1.1".into(),
            ..Default::default()
        };
        assert!(r.wants_keep_alive());

        r.version = "HTTP/1.0".into();
        assert!(!r.wants_keep_alive());

        r.headers.push(("Connection".into(), "keep-alive".into()));
        assert!(r.wants_keep_alive());

        r.headers.clear();
        r.version = "HTTP/1.1".into();
        r.headers.push(("Connection".into(), "close".into()));
        assert!(!r.wants_keep_alive());
    }

    #[tokio::test]
    async fn response_is_well_formed() {
        let mut out = Vec::new();
        let resp = Response::json(200, b"{}".to_vec());
        write_response(&mut out, &resp, false).await.unwrap();

        let s = String::from_utf8(out).unwrap();
        assert!(s.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(s.contains("content-type: application/json; charset=utf-8\r\n"));
        assert!(s.contains("content-length: 2\r\n"));
        assert!(s.contains("connection: close\r\n"));
        assert!(s.ends_with("\r\n\r\n{}"));
    }

    #[tokio::test]
    async fn serves_two_requests_on_one_connection() {
        let (client, mut server) = tokio::io::duplex(8192);
        let (mut rx, mut tx) = tokio::io::split(client);

        let handle = tokio::spawn(async move {
            let mut count = 0;
            serve(&mut server, |_req| {
                count += 1;
                Response::text(200, format!("hit {count}"))
            })
            .await
            .unwrap();
            count
        });

        tx.write_all(b"GET /one HTTP/1.1\r\nHost: k\r\n\r\n")
            .await
            .unwrap();
        tx.write_all(b"GET /two HTTP/1.1\r\nHost: k\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        tx.flush().await.unwrap();

        let mut got = Vec::new();
        rx.read_to_end(&mut got).await.unwrap();
        let s = String::from_utf8_lossy(&got);
        assert!(s.contains("hit 1"), "missing first response in {s}");
        assert!(s.contains("hit 2"), "missing second response in {s}");
        assert_eq!(handle.await.unwrap(), 2);
    }
}
