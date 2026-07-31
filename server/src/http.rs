//! Shared response type for both HTTP versions.

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn json(status: u16, body: Vec<u8>) -> Response {
        Response {
            status,
            headers: vec![
                ("content-type".into(), "application/json; charset=utf-8".into()),
                // The whole point is that the browser reaches this origin
                // directly from a page served elsewhere, so CORS must be open.
                ("access-control-allow-origin".into(), "*".into()),
                // Every response is connection-specific; caching it anywhere
                // would serve one visitor's fingerprint to another.
                ("cache-control".into(), "no-store, max-age=0".into()),
            ],
            body,
        }
    }

    pub fn text(status: u16, body: impl Into<String>) -> Response {
        let body = body.into().into_bytes();
        Response {
            status,
            headers: vec![
                ("content-type".into(), "text/plain; charset=utf-8".into()),
                ("access-control-allow-origin".into(), "*".into()),
                ("cache-control".into(), "no-store, max-age=0".into()),
            ],
            body,
        }
    }

    pub fn status_text(&self) -> &'static str {
        match self.status {
            200 => "OK",
            204 => "No Content",
            301 => "Moved Permanently",
            400 => "Bad Request",
            404 => "Not Found",
            429 => "Too Many Requests",
            500 => "Internal Server Error",
            _ => "Unknown",
        }
    }
}
