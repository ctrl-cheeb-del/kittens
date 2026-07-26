//! JA4 TLS client fingerprinting (FoxIO, BSD-3-Clause).
//!
//! Only JA4 proper is implemented here. The rest of the JA4+ suite (JA4H,
//! JA4S, JA4X, ...) is FoxIO License 1.1, which forbids monetisation without
//! an OEM licence — deliberately left out so this stays unencumbered.
//!
//! Layout: `ja4_a _ ja4_b _ ja4_c`
//!   a: protocol, version, SNI flag, cipher count, extension count, ALPN chars
//!   b: sha256 of the sorted cipher list, first 12 hex chars
//!   c: sha256 of the sorted extension list + signature algorithms, first 12

use sha2::{Digest, Sha256};

use super::parse::{is_grease, ClientHello, EXT_ALPN, EXT_SERVER_NAME};

/// Transport, as the leading character of JA4.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Tcp,
    Quic,
}

impl Transport {
    fn ch(self) -> char {
        match self {
            Transport::Tcp => 't',
            Transport::Quic => 'q',
        }
    }
}

/// Map a TLS version to its two-character JA4 code.
fn version_code(v: u16) -> &'static str {
    match v {
        0x0304 => "13",
        0x0303 => "12",
        0x0302 => "11",
        0x0301 => "10",
        0x0300 => "s3",
        0x0002 => "s2",
        0xfeff => "d1",
        0xfefd => "d2",
        0xfefc => "d3",
        _ => "00",
    }
}

/// Counts saturate at 99 — the field is only two characters wide.
fn two_digit(n: usize) -> String {
    format!("{:02}", n.min(99))
}

/// First and last character of the first ALPN value.
///
/// Per spec: if either the first or last *byte* is not ASCII alphanumeric, use
/// the first and last characters of the value's hex encoding instead. Absent or
/// empty ALPN yields "00".
fn alpn_chars(alpn: &[Vec<u8>]) -> String {
    let Some(first) = alpn.iter().find(|p| !p.is_empty()) else {
        return "00".to_string();
    };
    let f = first[0];
    let l = first[first.len() - 1];
    if f.is_ascii_alphanumeric() && l.is_ascii_alphanumeric() {
        format!("{}{}", f as char, l as char)
    } else {
        let hexed = hex::encode(first);
        let b = hexed.as_bytes();
        format!("{}{}", b[0] as char, b[b.len() - 1] as char)
    }
}

/// sha256 truncated to 12 hex chars; the all-zero sentinel for empty input.
fn trunc_hash(s: &str) -> String {
    if s.is_empty() {
        return "000000000000".to_string();
    }
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    hex::encode(h.finalize())[..12].to_string()
}

fn hex4(v: u16) -> String {
    format!("{v:04x}")
}

/// Full JA4 result, including the intermediate strings so the UI can show its
/// working rather than just a hash.
#[derive(Debug, Clone)]
pub struct Ja4 {
    pub fingerprint: String,
    pub a: String,
    pub b: String,
    pub c: String,
    /// The pre-hash cipher list behind `b`.
    pub b_raw: String,
    /// The pre-hash extension + signature-algorithm list behind `c`.
    pub c_raw: String,
    /// JA4 with both hash halves left unhashed — FoxIO calls this the "raw"
    /// or `ja4_r` form. Useful for eyeballing why two clients differ.
    pub raw: String,
}

pub fn ja4(ch: &ClientHello, transport: Transport) -> Ja4 {
    let ciphers = ch.ciphers_no_grease();
    let ext_types = ch.extension_types();

    let sni = if ch.extensions.iter().any(|e| e.typ == EXT_SERVER_NAME) {
        'd'
    } else {
        'i'
    };

    let a = format!(
        "{}{}{}{}{}{}",
        transport.ch(),
        version_code(ch.effective_version()),
        sni,
        two_digit(ciphers.len()),
        two_digit(ext_types.len()),
        alpn_chars(&ch.alpn),
    );

    // b: ciphers as 4-char hex, sorted lexicographically.
    let mut cipher_hex: Vec<String> = ciphers.iter().map(|c| hex4(*c)).collect();
    cipher_hex.sort();
    let b_raw = cipher_hex.join(",");

    // c: extensions sorted, with SNI and ALPN removed so the fingerprint is
    // stable across hostnames. They still count toward ja4_a's extension total.
    let mut ext_hex: Vec<String> = ext_types
        .iter()
        .filter(|t| **t != EXT_SERVER_NAME && **t != EXT_ALPN)
        .map(|t| hex4(*t))
        .collect();
    ext_hex.sort();

    // Signature algorithms keep wire order and are appended after an underscore.
    let sig_hex: Vec<String> = ch
        .signature_algorithms
        .iter()
        .copied()
        .filter(|s| !is_grease(*s))
        .map(hex4)
        .collect();

    let c_raw = if sig_hex.is_empty() {
        ext_hex.join(",")
    } else {
        format!("{}_{}", ext_hex.join(","), sig_hex.join(","))
    };

    // The empty-list sentinel keys off the extension list, not the combined
    // string: no extensions means ja4_c is all zeroes even if sig algs existed.
    let c = if ext_hex.is_empty() {
        "000000000000".to_string()
    } else {
        trunc_hash(&c_raw)
    };
    let b = trunc_hash(&b_raw);

    Ja4 {
        fingerprint: format!("{a}_{b}_{c}"),
        raw: format!("{a}_{b_raw}_{c_raw}"),
        a,
        b,
        c,
        b_raw,
        c_raw,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_mapping() {
        assert_eq!(version_code(0x0304), "13");
        assert_eq!(version_code(0x0303), "12");
        assert_eq!(version_code(0x0300), "s3");
        assert_eq!(version_code(0xbeef), "00");
    }

    #[test]
    fn alpn_char_extraction() {
        assert_eq!(alpn_chars(&[b"h2".to_vec()]), "h2");
        assert_eq!(alpn_chars(&[b"http/1.1".to_vec()]), "h1");
        assert_eq!(alpn_chars(&[b"h3".to_vec()]), "h3");
        // Single character is used for both positions.
        assert_eq!(alpn_chars(&[b"a".to_vec()]), "aa");
        // Absent ALPN.
        assert_eq!(alpn_chars(&[]), "00");
        // Non-alphanumeric falls back to first/last of the hex encoding:
        // 0x01,0x02 -> "0102" -> '0' and '2'.
        assert_eq!(alpn_chars(&[vec![0x01, 0x02]]), "02");
    }

    #[test]
    fn counts_saturate_at_99() {
        assert_eq!(two_digit(0), "00");
        assert_eq!(two_digit(7), "07");
        assert_eq!(two_digit(150), "99");
    }

    #[test]
    fn empty_lists_use_zero_sentinel() {
        assert_eq!(trunc_hash(""), "000000000000");
    }

    /// Truncation must be 12 hex chars of a real sha256.
    #[test]
    fn trunc_hash_is_sha256_prefix() {
        let full = hex::encode(Sha256::digest(b"1301,1302"));
        assert_eq!(trunc_hash("1301,1302"), full[..12]);
    }

    fn hello_with(
        ciphers: Vec<u16>,
        exts: Vec<u16>,
        sigs: Vec<u16>,
        alpn: Vec<&[u8]>,
        version: u16,
    ) -> ClientHello {
        use super::super::parse::Extension;
        ClientHello {
            legacy_version: 0x0303,
            cipher_suites: ciphers,
            extensions: exts
                .into_iter()
                .map(|t| Extension {
                    typ: t,
                    data: Vec::new(),
                })
                .collect(),
            signature_algorithms: sigs,
            alpn: alpn.into_iter().map(|a| a.to_vec()).collect(),
            supported_versions: vec![version],
            ..Default::default()
        }
    }

    #[test]
    fn sni_and_alpn_count_but_do_not_hash() {
        // Both hellos have the same extensions apart from SNI/ALPN presence.
        let with = hello_with(
            vec![0x1301],
            vec![EXT_SERVER_NAME, EXT_ALPN, 0x002b, 0x000a],
            vec![0x0403],
            vec![b"h2"],
            0x0304,
        );
        let out = ja4(&with, Transport::Tcp);

        // 4 extensions counted (SNI and ALPN included), 1 cipher.
        assert_eq!(out.a, "t13d0104h2");
        // ...but only 002b and 000a feed the hash.
        assert_eq!(out.c_raw, "000a,002b_0403");
    }

    #[test]
    fn grease_is_ignored_everywhere() {
        let clean = hello_with(
            vec![0x1301, 0x1302],
            vec![0x002b, 0x000a],
            vec![0x0403],
            vec![b"h2"],
            0x0304,
        );
        let greased = hello_with(
            vec![0x0a0a, 0x1301, 0x1302],
            vec![0x1a1a, 0x002b, 0x000a],
            vec![0x0403],
            vec![b"h2"],
            0x0304,
        );
        assert_eq!(
            ja4(&clean, Transport::Tcp).fingerprint,
            ja4(&greased, Transport::Tcp).fingerprint,
            "GREASE injection must not change the fingerprint"
        );
    }

    #[test]
    fn cipher_order_does_not_affect_hash_but_is_sorted() {
        let a = hello_with(
            vec![0x1302, 0x1301],
            vec![0x002b],
            vec![],
            vec![b"h2"],
            0x0304,
        );
        let b = hello_with(
            vec![0x1301, 0x1302],
            vec![0x002b],
            vec![],
            vec![b"h2"],
            0x0304,
        );
        assert_eq!(ja4(&a, Transport::Tcp).b, ja4(&b, Transport::Tcp).b);
        assert_eq!(ja4(&a, Transport::Tcp).b_raw, "1301,1302");
    }

    #[test]
    fn signature_algorithms_keep_wire_order() {
        let a = hello_with(
            vec![0x1301],
            vec![0x002b],
            vec![0x0804, 0x0403],
            vec![b"h2"],
            0x0304,
        );
        assert_eq!(ja4(&a, Transport::Tcp).c_raw, "002b_0804,0403");
    }

    #[test]
    fn quic_transport_prefix() {
        let h = hello_with(
            vec![0x1301],
            vec![0x002b],
            vec![],
            vec![b"h3"],
            0x0304,
        );
        assert!(ja4(&h, Transport::Quic).fingerprint.starts_with('q'));
        assert!(ja4(&h, Transport::Tcp).fingerprint.starts_with('t'));
    }

    /// The worked example from FoxIO's own JA4 specification, in the exact
    /// wire order they give for it. This is the authoritative check: if this
    /// passes, our fingerprints agree with every other conforming
    /// implementation, and the site is worth something.
    #[test]
    fn foxio_reference_vector() {
        let ciphers = vec![
            0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9, 0xcca8, 0xc013,
            0xc014, 0x009c, 0x009d, 0x002f, 0x0035,
        ];
        let exts = vec![
            0x001b, 0x0000, 0x0033, 0x0010, 0x4469, 0x0017, 0x002d, 0x000d, 0x0005, 0x0023,
            0x0012, 0x002b, 0xff01, 0x000b, 0x000a, 0x0015,
        ];
        let sigs = vec![
            0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0501, 0x0806, 0x0601,
        ];

        let hello = hello_with(ciphers, exts, sigs, vec![b"h2"], 0x0304);
        let out = ja4(&hello, Transport::Tcp);

        assert_eq!(out.a, "t13d1516h2");
        assert_eq!(out.b, "8daaf6152771");
        assert_eq!(out.c, "e5627efa2ab1");
        assert_eq!(out.fingerprint, "t13d1516h2_8daaf6152771_e5627efa2ab1");

        // The unhashed form must match theirs verbatim too.
        assert_eq!(
            out.raw,
            "t13d1516h2_\
             002f,0035,009c,009d,1301,1302,1303,c013,c014,c02b,c02c,c02f,c030,cca8,cca9_\
             0005,000a,000b,000d,0012,0015,0017,001b,0023,002b,002d,0033,4469,ff01_\
             0403,0804,0401,0503,0805,0501,0806,0601"
        );
    }

    #[test]
    fn no_extensions_yields_zero_sentinel_for_c() {
        let h = hello_with(vec![0x1301], vec![], vec![0x0403], vec![], 0x0303);
        let out = ja4(&h, Transport::Tcp);
        assert_eq!(out.c, "000000000000");
        assert_eq!(out.a, "t12i0100_00".replace('_', ""));
    }
}
