//! JA3 (Salesforce, BSD-3-Clause).
//!
//! `SSLVersion,Ciphers,Extensions,EllipticCurves,ECPointFormats` — all fields
//! decimal, dash-separated, GREASE removed, wire order preserved. MD5 of that
//! string is the JA3 hash.
//!
//! Note JA3 hashes the *legacy* version field, which reads TLS 1.2 for every
//! modern client regardless of real capability. That's one of the reasons JA4
//! superseded it; we emit both.

use md5::{Digest, Md5};

use super::parse::{is_grease, ClientHello, EXT_EC_POINT_FORMATS, EXT_SUPPORTED_GROUPS};

fn join_u16(vals: &[u16]) -> String {
    vals.iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join("-")
}

/// The unhashed JA3 string.
pub fn ja3_string(ch: &ClientHello) -> String {
    let ciphers = ch.ciphers_no_grease();
    let extensions = ch.extension_types();

    // JA3 reads curves and point formats from the extensions directly. If an
    // extension is absent the field is empty, not zero.
    let curves: Vec<u16> = if ch.extensions.iter().any(|e| e.typ == EXT_SUPPORTED_GROUPS) {
        ch.supported_groups
            .iter()
            .copied()
            .filter(|g| !is_grease(*g))
            .collect()
    } else {
        Vec::new()
    };

    let point_formats: Vec<u16> = if ch
        .extensions
        .iter()
        .any(|e| e.typ == EXT_EC_POINT_FORMATS)
    {
        ch.ec_point_formats.iter().map(|f| *f as u16).collect()
    } else {
        Vec::new()
    };

    format!(
        "{},{},{},{},{}",
        ch.legacy_version,
        join_u16(&ciphers),
        join_u16(&extensions),
        join_u16(&curves),
        join_u16(&point_formats),
    )
}

/// MD5 of the JA3 string, lowercase hex.
pub fn ja3_hash(ja3: &str) -> String {
    let mut h = Md5::new();
    h.update(ja3.as_bytes());
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The canonical example from the Salesforce JA3 README.
    #[test]
    fn known_ja3_string_hashes_correctly() {
        let s = "769,4-5-10-9-100-98-3-6-19-18-99,,,";
        assert_eq!(ja3_hash(s), "de350869b8c85de67a350c8d186f11e6");
    }

    #[test]
    fn empty_string_matches_md5_of_empty() {
        assert_eq!(ja3_hash(""), "d41d8cd98f00b204e9800998ecf8427e");
    }
}
