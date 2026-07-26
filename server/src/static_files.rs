//! Serves the exported Next.js site alongside the API.
//!
//! Same host as /api/* by design: the page and the fingerprint then share one
//! TLS connection, so what the UI reports is measured from the very handshake
//! that loaded it — no CORS, no second connection, nothing to get out of sync.

use std::path::{Component, Path, PathBuf};

use crate::http::Response;

/// Largest file we'll read into memory. The whole export is ~1.2 MB; anything
/// bigger than this does not belong in the static bundle.
const MAX_FILE: u64 = 8 * 1024 * 1024;

pub struct StaticSite {
    root: Option<PathBuf>,
}

impl StaticSite {
    /// `root` is the directory of the exported site. A missing directory is not
    /// an error — the API still works, requests for pages just 404. That keeps
    /// `cargo run` useful without a Node build.
    pub fn new(root: Option<PathBuf>) -> StaticSite {
        let root = root.and_then(|r| match r.canonicalize() {
            Ok(c) if c.is_dir() => Some(c),
            _ => None,
        });
        StaticSite { root }
    }

    pub fn is_available(&self) -> bool {
        self.root.is_some()
    }

    /// Resolve a URL path to a file inside the root.
    ///
    /// Rejects anything that could escape: `..` components, absolute paths,
    /// Windows prefixes, and (belt and braces) any resolved path that does not
    /// still start with the canonical root.
    fn resolve(&self, url_path: &str) -> Option<PathBuf> {
        let root = self.root.as_ref()?;

        let trimmed = url_path.trim_start_matches('/');
        // Reject encoded traversal and NUL before doing anything else.
        if trimmed.contains('\0') || trimmed.contains("..") || trimmed.contains('\\') {
            return None;
        }

        let mut candidate = root.clone();
        for component in Path::new(trimmed).components() {
            match component {
                Component::Normal(part) => candidate.push(part),
                // Anything that isn't a plain name is an escape attempt.
                Component::ParentDir
                | Component::RootDir
                | Component::Prefix(_)
                | Component::CurDir => return None,
            }
        }

        // A directory maps to its index, matching `trailingSlash: true`.
        if candidate.is_dir() {
            candidate.push("index.html");
        }

        let canonical = candidate.canonicalize().ok()?;
        if !canonical.starts_with(root) {
            return None;
        }
        if !canonical.is_file() {
            return None;
        }
        Some(canonical)
    }

    /// Serve `url_path`, or None if there is no such file.
    pub fn serve(&self, url_path: &str) -> Option<Response> {
        let path = self.resolve(url_path)?;

        let meta = std::fs::metadata(&path).ok()?;
        if meta.len() > MAX_FILE {
            return None;
        }
        let body = std::fs::read(&path).ok()?;

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        // Next emits content-hashed filenames under /_next/static, so those are
        // safe to cache forever. HTML must always be revalidated or a deploy
        // would leave stale pages pointing at chunks that no longer exist.
        let immutable = url_path.starts_with("/_next/static/");
        let cache = if immutable {
            "public, max-age=31536000, immutable"
        } else if ext == "html" {
            "no-cache"
        } else {
            "public, max-age=3600"
        };

        Some(Response {
            status: 200,
            headers: vec![
                ("content-type".into(), content_type(&ext).into()),
                ("cache-control".into(), cache.into()),
                ("x-content-type-options".into(), "nosniff".into()),
            ],
            body,
        })
    }

    /// The exported 404 page, for unmatched non-API paths.
    pub fn not_found(&self) -> Option<Response> {
        let mut r = self.serve("/404.html")?;
        r.status = 404;
        Some(r)
    }
}

fn content_type(ext: &str) -> &'static str {
    match ext {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "txt" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "map" => "application/json",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Build a throwaway site tree, plus a secret file *outside* it that no
    /// request should ever be able to reach.
    fn fixture() -> (tempdir::TempDir, StaticSite) {
        let dir = tempdir::TempDir::new();
        let root = dir.path().join("out");
        fs::create_dir_all(root.join("_next/static/chunks")).unwrap();
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join("index.html"), b"<h1>home</h1>").unwrap();
        fs::write(root.join("404.html"), b"<h1>gone</h1>").unwrap();
        fs::write(root.join("docs/index.html"), b"<h1>docs</h1>").unwrap();
        fs::write(root.join("_next/static/chunks/a.js"), b"console.log(1)").unwrap();
        fs::write(dir.path().join("secret.txt"), b"TOP SECRET").unwrap();

        let site = StaticSite::new(Some(root));
        (dir, site)
    }

    #[test]
    fn serves_index_for_root() {
        let (_d, site) = fixture();
        let r = site.serve("/").expect("root should serve index.html");
        assert_eq!(r.status, 200);
        assert_eq!(r.body, b"<h1>home</h1>");
        assert!(r
            .headers
            .iter()
            .any(|(k, v)| k == "content-type" && v.starts_with("text/html")));
    }

    #[test]
    fn serves_directory_index() {
        let (_d, site) = fixture();
        assert_eq!(site.serve("/docs/").unwrap().body, b"<h1>docs</h1>");
        // Without the trailing slash too.
        assert_eq!(site.serve("/docs").unwrap().body, b"<h1>docs</h1>");
    }

    #[test]
    fn hashed_assets_are_cached_forever_html_is_not() {
        let (_d, site) = fixture();
        let js = site.serve("/_next/static/chunks/a.js").unwrap();
        let cache = js
            .headers
            .iter()
            .find(|(k, _)| k == "cache-control")
            .map(|(_, v)| v.clone())
            .unwrap();
        assert!(cache.contains("immutable"), "got {cache}");

        let html = site.serve("/").unwrap();
        let cache = html
            .headers
            .iter()
            .find(|(k, _)| k == "cache-control")
            .map(|(_, v)| v.clone())
            .unwrap();
        assert_eq!(cache, "no-cache", "HTML must revalidate across deploys");
    }

    /// The important one: nothing may escape the root.
    #[test]
    fn path_traversal_is_refused() {
        let (_d, site) = fixture();
        for attack in [
            "/../secret.txt",
            "/../../secret.txt",
            "/docs/../../secret.txt",
            "//../secret.txt",
            "/./../secret.txt",
            "/..%2fsecret.txt",
            "/....//secret.txt",
            "/docs/..\\secret.txt",
        ] {
            assert!(
                site.serve(attack).is_none(),
                "traversal not blocked: {attack}"
            );
        }
    }

    #[test]
    fn absolute_paths_are_refused() {
        let (_d, site) = fixture();
        assert!(site.serve("//etc/passwd").is_none());
        assert!(site.serve("/etc/passwd").is_none());
    }

    #[test]
    fn nul_byte_is_refused() {
        let (_d, site) = fixture();
        assert!(site.serve("/index.html\0.js").is_none());
    }

    #[test]
    fn missing_file_is_none() {
        let (_d, site) = fixture();
        assert!(site.serve("/nope.html").is_none());
    }

    #[test]
    fn not_found_page_has_404_status() {
        let (_d, site) = fixture();
        let r = site.not_found().unwrap();
        assert_eq!(r.status, 404);
        assert_eq!(r.body, b"<h1>gone</h1>");
    }

    #[test]
    fn absent_root_degrades_to_api_only() {
        let site = StaticSite::new(Some(PathBuf::from("/nonexistent/kittens/out")));
        assert!(!site.is_available());
        assert!(site.serve("/").is_none());
        assert!(site.not_found().is_none());

        let none = StaticSite::new(None);
        assert!(!none.is_available());
        assert!(none.serve("/").is_none());
    }

    #[test]
    fn content_types_cover_the_export() {
        assert_eq!(content_type("html"), "text/html; charset=utf-8");
        assert_eq!(content_type("js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type("css"), "text/css; charset=utf-8");
        assert_eq!(content_type("woff2"), "font/woff2");
        assert_eq!(content_type("weird"), "application/octet-stream");
    }

    /// Minimal temp-dir helper; avoids pulling a dev-dependency in for this.
    mod tempdir {
        use std::path::{Path, PathBuf};
        use std::sync::atomic::{AtomicUsize, Ordering};

        static COUNTER: AtomicUsize = AtomicUsize::new(0);

        pub struct TempDir(PathBuf);

        impl TempDir {
            #[allow(clippy::new_without_default)]
            pub fn new() -> TempDir {
                let n = COUNTER.fetch_add(1, Ordering::SeqCst);
                let p = std::env::temp_dir().join(format!("kittens-test-{}-{n}", std::process::id()));
                std::fs::create_dir_all(&p).unwrap();
                TempDir(p)
            }
            pub fn path(&self) -> &Path {
                &self.0
            }
        }

        impl Drop for TempDir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }
}
