//! The public JSON shape.
//!
//! Two audiences pull on this in opposite directions: the UI wants every value
//! decoded and labelled, while scraper authors curl it in a loop and want the
//! hashes with nothing in the way. Rather than compromise, `/api/all` is
//! maximally verbose and `/api/clean` is four lines — same data, two lenses.

use serde::Serialize;

use crate::http2::akamai::Observation;
use crate::http2::frame::{setting_name, Priority};
use crate::tls::ja3;
use crate::tls::ja4::{self, Ja4, Transport};
use crate::tls::names;
use crate::tls::parse::{is_grease, ClientHello};

/// A protocol constant, rendered every way a consumer might want it.
#[derive(Debug, Serialize)]
pub struct Value {
    pub value: u16,
    pub hex: String,
    pub name: &'static str,
    /// True for RFC 8701 GREASE values, which are excluded from all hashes.
    pub grease: bool,
}

fn val(v: u16, f: fn(u16) -> &'static str) -> Value {
    let grease = is_grease(v);
    Value {
        value: v,
        hex: format!("0x{v:04x}"),
        name: if grease { "GREASE" } else { f(v) },
        grease,
    }
}

fn vals(vs: &[u16], f: fn(u16) -> &'static str) -> Vec<Value> {
    vs.iter().map(|v| val(*v, f)).collect()
}

#[derive(Debug, Serialize)]
pub struct ExtensionInfo {
    pub value: u16,
    pub hex: String,
    pub name: &'static str,
    pub grease: bool,
    /// Payload length in bytes. Useful for spotting padding extensions, whose
    /// size varies with the rest of the hello.
    pub length: usize,
}

#[derive(Debug, Serialize)]
pub struct TlsInfo {
    /// Version actually negotiated by rustls, once the handshake completed.
    pub negotiated_version: Option<String>,
    pub negotiated_cipher: Option<String>,
    pub negotiated_alpn: Option<String>,

    /// The legacy `client_version` field. Reads TLS 1.2 for essentially every
    /// modern client; `supported_versions` carries the truth.
    pub legacy_version: String,
    /// Highest non-GREASE entry of supported_versions, else the legacy field.
    pub effective_version: String,

    pub sni: Option<String>,
    pub session_id_length: usize,
    pub cipher_suites: Vec<Value>,
    pub extensions: Vec<ExtensionInfo>,
    pub supported_groups: Vec<Value>,
    pub supported_versions: Vec<Value>,
    pub signature_algorithms: Vec<Value>,
    pub key_share_groups: Vec<Value>,
    pub cert_compression: Vec<Value>,
    pub ec_point_formats: Vec<String>,
    pub psk_key_exchange_modes: Vec<String>,
    pub compression_methods: Vec<u8>,
    pub alpn: Vec<String>,
    pub application_settings: Vec<String>,
    pub record_size_limit: Option<u16>,
}

#[derive(Debug, Serialize)]
pub struct SettingInfo {
    pub id: u16,
    pub name: &'static str,
    pub value: u32,
}

#[derive(Debug, Serialize)]
pub struct PriorityInfo {
    pub stream_id: u32,
    pub exclusive: bool,
    pub depends_on: u32,
    pub weight: u16,
}

#[derive(Debug, Serialize)]
pub struct Http2Info {
    pub akamai_fingerprint: String,
    pub akamai_fingerprint_hash: String,
    pub settings: Vec<SettingInfo>,
    pub window_update: Option<u32>,
    pub priorities: Vec<PriorityInfo>,
    pub pseudo_header_order: Vec<String>,
    /// Every header in wire order, pseudo-headers included.
    pub headers: Vec<[String; 2]>,
}

#[derive(Debug, Serialize)]
pub struct Http1Info {
    pub method: String,
    pub path: String,
    pub version: String,
    pub headers: Vec<[String; 2]>,
    /// Header names alone, in order — the fingerprintable part.
    pub header_order: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct Ja4Parts {
    pub a: String,
    pub b: String,
    pub c: String,
    pub b_raw: String,
    pub c_raw: String,
}

#[derive(Debug, Serialize)]
pub struct Meta {
    pub service: &'static str,
    pub version: &'static str,
    pub docs: &'static str,
}

#[derive(Debug, Serialize)]
pub struct Fingerprint {
    pub kittens: Meta,
    pub ip: String,
    /// "h2" or "http/1.1".
    pub protocol: String,
    pub method: String,
    pub path: String,
    pub user_agent: Option<String>,

    pub tls: TlsInfo,

    pub ja3: String,
    pub ja3_hash: String,
    pub ja4: String,
    /// JA4 with both hash halves left expanded — handy for diffing two clients.
    pub ja4_r: String,
    pub ja4_parts: Ja4Parts,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub http2: Option<Http2Info>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http1: Option<Http1Info>,
}

/// The terse form: just the hashes. This is what belongs in a CI assertion.
#[derive(Debug, Serialize)]
pub struct Clean {
    pub ja3_hash: String,
    pub ja4: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub akamai_hash: Option<String>,
    pub user_agent: Option<String>,
}

/// Everything the connection layer learned, before it's shaped into JSON.
pub struct Capture<'a> {
    pub hello: &'a ClientHello,
    pub negotiated_version: Option<String>,
    pub negotiated_cipher: Option<String>,
    pub negotiated_alpn: Option<String>,
    pub peer_ip: String,
    pub h2: Option<(&'a Observation, &'a [(String, String)])>,
    pub h1: Option<&'a crate::http1::Request>,
}

fn priority_info(p: &Priority) -> PriorityInfo {
    PriorityInfo {
        stream_id: p.stream_id,
        exclusive: p.exclusive,
        depends_on: p.depends_on,
        weight: p.weight,
    }
}

fn header_pairs(hs: &[(String, String)]) -> Vec<[String; 2]> {
    hs.iter().map(|(k, v)| [k.clone(), v.clone()]).collect()
}

pub fn build(cap: &Capture) -> Fingerprint {
    let ch = cap.hello;

    let ja3_str = ja3::ja3_string(ch);
    let ja3_hash = ja3::ja3_hash(&ja3_str);
    let ja4: Ja4 = ja4::ja4(ch, Transport::Tcp);

    let tls = TlsInfo {
        negotiated_version: cap.negotiated_version.clone(),
        negotiated_cipher: cap.negotiated_cipher.clone(),
        negotiated_alpn: cap.negotiated_alpn.clone(),
        legacy_version: format!(
            "{} (0x{:04x})",
            names::tls_version(ch.legacy_version),
            ch.legacy_version
        ),
        effective_version: format!(
            "{} (0x{:04x})",
            names::tls_version(ch.effective_version()),
            ch.effective_version()
        ),
        sni: ch.server_name.clone(),
        session_id_length: ch.session_id.len(),
        cipher_suites: vals(&ch.cipher_suites, names::cipher_suite),
        extensions: ch
            .extensions
            .iter()
            .map(|e| {
                let grease = is_grease(e.typ);
                ExtensionInfo {
                    value: e.typ,
                    hex: format!("0x{:04x}", e.typ),
                    name: if grease {
                        "GREASE"
                    } else {
                        names::extension(e.typ)
                    },
                    grease,
                    length: e.data.len(),
                }
            })
            .collect(),
        supported_groups: vals(&ch.supported_groups, names::supported_group),
        supported_versions: vals(&ch.supported_versions, names::tls_version),
        signature_algorithms: vals(&ch.signature_algorithms, names::signature_algorithm),
        key_share_groups: vals(&ch.key_share_groups, names::supported_group),
        cert_compression: vals(&ch.cert_compression_algs, names::cert_compression),
        ec_point_formats: ch
            .ec_point_formats
            .iter()
            .map(|f| format!("{} (0x{:02x})", names::ec_point_format(*f), f))
            .collect(),
        psk_key_exchange_modes: ch
            .psk_key_exchange_modes
            .iter()
            .map(|m| format!("{} (0x{:02x})", names::psk_key_exchange_mode(*m), m))
            .collect(),
        compression_methods: ch.compression_methods.clone(),
        alpn: ch.alpn_strings(),
        application_settings: ch.application_settings_strings(),
        record_size_limit: ch.record_size_limit,
    };

    let http2 = cap.h2.map(|(obs, headers)| {
        let fp = crate::http2::akamai::fingerprint(obs);
        Http2Info {
            akamai_fingerprint_hash: crate::http2::akamai::hash(&fp),
            akamai_fingerprint: fp,
            settings: obs
                .settings
                .iter()
                .map(|(id, value)| SettingInfo {
                    id: *id,
                    name: setting_name(*id),
                    value: *value,
                })
                .collect(),
            window_update: obs.window_update,
            priorities: obs.priorities.iter().map(priority_info).collect(),
            pseudo_header_order: obs
                .pseudo_header_order
                .iter()
                .map(|c| c.to_string())
                .collect(),
            headers: header_pairs(headers),
        }
    });

    let http1 = cap.h1.map(|r| Http1Info {
        method: r.method.clone(),
        path: r.path.clone(),
        version: r.version.clone(),
        headers: header_pairs(&r.headers),
        header_order: r.header_order(),
    });

    // Pull method/path/UA from whichever protocol served this request.
    let (protocol, method, path, user_agent) = match (cap.h2, cap.h1) {
        (Some((_, headers)), _) => {
            let find = |n: &str| {
                headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(n))
                    .map(|(_, v)| v.clone())
            };
            (
                "h2".to_string(),
                find(":method").unwrap_or_else(|| "GET".into()),
                find(":path").unwrap_or_else(|| "/".into()),
                find("user-agent"),
            )
        }
        (_, Some(r)) => (
            "http/1.1".to_string(),
            r.method.clone(),
            r.path.clone(),
            r.get("user-agent").map(|s| s.to_string()),
        ),
        _ => ("unknown".into(), "GET".into(), "/".into(), None),
    };

    Fingerprint {
        kittens: Meta {
            service: "kittens",
            version: env!("CARGO_PKG_VERSION"),
            docs: "https://kittens.sh/docs",
        },
        ip: cap.peer_ip.clone(),
        protocol,
        method,
        path,
        user_agent,
        tls,
        ja3: ja3_str,
        ja3_hash,
        ja4: ja4.fingerprint.clone(),
        ja4_r: ja4.raw.clone(),
        ja4_parts: Ja4Parts {
            a: ja4.a,
            b: ja4.b,
            c: ja4.c,
            b_raw: ja4.b_raw,
            c_raw: ja4.c_raw,
        },
        http2,
        http1,
    }
}

pub fn clean(fp: &Fingerprint) -> Clean {
    Clean {
        ja3_hash: fp.ja3_hash.clone(),
        ja4: fp.ja4.clone(),
        akamai_hash: fp
            .http2
            .as_ref()
            .map(|h| h.akamai_fingerprint_hash.clone()),
        user_agent: fp.user_agent.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tls::parse::Extension;

    fn sample_hello() -> ClientHello {
        ClientHello {
            legacy_version: 0x0303,
            session_id: vec![0; 32],
            cipher_suites: vec![0x0a0a, 0x1301, 0xc02b],
            compression_methods: vec![0],
            extensions: vec![
                Extension {
                    typ: 0x0000,
                    data: vec![0; 15],
                },
                Extension {
                    typ: 0x002b,
                    data: vec![0; 5],
                },
            ],
            server_name: Some("tls.kittens.sh".into()),
            alpn: vec![b"h2".to_vec()],
            supported_groups: vec![0x11ec, 0x001d],
            signature_algorithms: vec![0x0403],
            supported_versions: vec![0x0a0a, 0x0304],
            ..Default::default()
        }
    }

    fn capture_h1(req: &crate::http1::Request, hello: &ClientHello) -> Fingerprint {
        build(&Capture {
            hello,
            negotiated_version: Some("TLS 1.3".into()),
            negotiated_cipher: Some("TLS13_AES_128_GCM_SHA256".into()),
            negotiated_alpn: Some("http/1.1".into()),
            peer_ip: "203.0.113.7".into(),
            h2: None,
            h1: Some(req),
        })
    }

    #[test]
    fn grease_is_flagged_but_retained_in_output() {
        let hello = sample_hello();
        let req = crate::http1::Request {
            method: "GET".into(),
            path: "/api/all".into(),
            version: "HTTP/1.1".into(),
            headers: vec![("User-Agent".into(), "curl/8.4.0".into())],
        };
        let fp = capture_h1(&req, &hello);

        // The raw list keeps GREASE so the UI can show it...
        assert_eq!(fp.tls.cipher_suites.len(), 3);
        assert!(fp.tls.cipher_suites[0].grease);
        assert_eq!(fp.tls.cipher_suites[0].name, "GREASE");
        // ...but it must not reach the fingerprint.
        assert!(!fp.ja3.contains("2570")); // 0x0a0a
        assert_eq!(fp.ja4_parts.a, "t13d0202h2");
    }

    #[test]
    fn names_are_resolved_for_the_ui() {
        let fp = capture_h1(
            &crate::http1::Request::default(),
            &sample_hello(),
        );
        assert_eq!(fp.tls.cipher_suites[1].name, "TLS_AES_128_GCM_SHA256");
        assert_eq!(fp.tls.supported_groups[0].name, "X25519MLKEM768");
        assert_eq!(fp.tls.extensions[1].name, "supported_versions");
        assert_eq!(fp.tls.extensions[0].length, 15);
    }

    #[test]
    fn legacy_and_effective_versions_differ() {
        let fp = capture_h1(&crate::http1::Request::default(), &sample_hello());
        assert!(fp.tls.legacy_version.starts_with("TLS 1.2"));
        assert!(fp.tls.effective_version.starts_with("TLS 1.3"));
    }

    #[test]
    fn h1_capture_omits_http2_block() {
        let fp = capture_h1(&crate::http1::Request::default(), &sample_hello());
        assert!(fp.http2.is_none());
        assert!(fp.http1.is_some());
        assert_eq!(fp.protocol, "http/1.1");

        let json = serde_json::to_string(&fp).unwrap();
        assert!(!json.contains("\"http2\""), "absent block must be omitted");
    }

    #[test]
    fn h2_capture_populates_akamai() {
        let hello = sample_hello();
        let obs = Observation {
            settings: vec![(1, 65536), (2, 0)],
            window_update: Some(15663105),
            priorities: vec![],
            pseudo_header_order: vec!['m', 'a', 's', 'p'],
        };
        let headers = vec![
            (":method".to_string(), "GET".to_string()),
            (":path".to_string(), "/api/all".to_string()),
            ("user-agent".to_string(), "Mozilla/5.0".to_string()),
        ];
        let fp = build(&Capture {
            hello: &hello,
            negotiated_version: Some("TLS 1.3".into()),
            negotiated_cipher: None,
            negotiated_alpn: Some("h2".into()),
            peer_ip: "203.0.113.7".into(),
            h2: Some((&obs, &headers)),
            h1: None,
        });

        assert_eq!(fp.protocol, "h2");
        assert_eq!(fp.path, "/api/all");
        assert_eq!(fp.user_agent.as_deref(), Some("Mozilla/5.0"));
        let h2 = fp.http2.unwrap();
        assert_eq!(h2.akamai_fingerprint, "1:65536;2:0|15663105|0|m,a,s,p");
        assert_eq!(h2.settings[0].name, "HEADER_TABLE_SIZE");
        assert_eq!(h2.akamai_fingerprint_hash.len(), 32);
    }

    #[test]
    fn clean_form_is_just_the_hashes() {
        let fp = capture_h1(&crate::http1::Request::default(), &sample_hello());
        let c = clean(&fp);
        let json = serde_json::to_value(&c).unwrap();
        let obj = json.as_object().unwrap();
        // akamai_hash is skipped for an h1 request, leaving three keys.
        assert_eq!(obj.len(), 3, "unexpected keys: {:?}", obj.keys());
        assert!(obj.contains_key("ja3_hash"));
        assert!(obj.contains_key("ja4"));
    }

    #[test]
    fn output_is_valid_json() {
        let fp = capture_h1(&crate::http1::Request::default(), &sample_hello());
        let s = serde_json::to_string_pretty(&fp).unwrap();
        let back: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(back["ja4"], fp.ja4);
        assert_eq!(back["ip"], "203.0.113.7");
    }
}
