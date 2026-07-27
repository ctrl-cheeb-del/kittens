//! The Akamai HTTP/2 fingerprint.
//!
//! `SETTINGS|WINDOW_UPDATE|PRIORITY|PSEUDO_HEADER_ORDER`
//!
//! e.g. Chrome: `1:65536;2:0;3:1000;4:6291456;6:262144|15663105|0|m,a,s,p`
//!      Firefox: `1:65536;4:131072;5:16384|12517377|3:0:0:201,...|m,p,a,s`
//!
//! Every field is order-sensitive, which is exactly why this can't be built on
//! a normal HTTP/2 library — they all hand you a parsed request with the
//! ordering discarded.

use md5::{Digest, Md5};

use super::frame::Priority;

/// Sentinel used when a client sent no connection-level WINDOW_UPDATE.
const NO_WINDOW_UPDATE: &str = "00";
/// Sentinel used when a client sent no PRIORITY frames.
const NO_PRIORITY: &str = "0";

#[derive(Debug, Clone, Default)]
pub struct Observation {
    /// SETTINGS entries in the order the client sent them.
    pub settings: Vec<(u16, u32)>,
    /// Increment from the connection-level (stream 0) WINDOW_UPDATE.
    pub window_update: Option<u32>,
    /// Standalone PRIORITY frames, in order. Priority carried on the HEADERS
    /// frame itself is recorded separately and excluded here, matching the
    /// reference implementations.
    pub priorities: Vec<Priority>,
    /// Pseudo-headers in wire order, as their single-letter codes.
    pub pseudo_header_order: Vec<char>,
    /// Every frame the client sent on this connection. Not part of the
    /// fingerprint, but a cheap tell: stacks differ in how much they say
    /// before asking for anything.
    pub total_frames: usize,
}

/// Map a pseudo-header name to its fingerprint letter.
pub fn pseudo_letter(name: &str) -> Option<char> {
    match name {
        ":method" => Some('m'),
        ":authority" => Some('a'),
        ":scheme" => Some('s'),
        ":path" => Some('p'),
        _ => None,
    }
}

pub fn fingerprint(obs: &Observation) -> String {
    let settings = obs
        .settings
        .iter()
        .map(|(id, v)| format!("{id}:{v}"))
        .collect::<Vec<_>>()
        .join(";");

    let window = obs
        .window_update
        .map(|w| w.to_string())
        .unwrap_or_else(|| NO_WINDOW_UPDATE.to_string());

    let priorities = if obs.priorities.is_empty() {
        NO_PRIORITY.to_string()
    } else {
        obs.priorities
            .iter()
            .map(|p| {
                format!(
                    "{}:{}:{}:{}",
                    p.stream_id,
                    if p.exclusive { 1 } else { 0 },
                    p.depends_on,
                    p.weight
                )
            })
            .collect::<Vec<_>>()
            .join(",")
    };

    let pseudo = obs
        .pseudo_header_order
        .iter()
        .map(|c| c.to_string())
        .collect::<Vec<_>>()
        .join(",");

    format!("{settings}|{window}|{priorities}|{pseudo}")
}

pub fn hash(fp: &str) -> String {
    let mut h = Md5::new();
    h.update(fp.as_bytes());
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prio(stream_id: u32, exclusive: bool, depends_on: u32, weight: u16) -> Priority {
        Priority {
            stream_id,
            exclusive,
            depends_on,
            weight,
        }
    }

    /// Reproduce a real Chrome fingerprint exactly.
    #[test]
    fn chrome_shape() {
        let obs = Observation {
            settings: vec![(1, 65536), (2, 0), (3, 1000), (4, 6291456), (6, 262144)],
            window_update: Some(15663105),
            priorities: vec![],
            pseudo_header_order: vec!['m', 'a', 's', 'p'],
            ..Default::default()
        };
        assert_eq!(
            fingerprint(&obs),
            "1:65536;2:0;3:1000;4:6291456;6:262144|15663105|0|m,a,s,p"
        );
    }

    /// Firefox: different settings, different pseudo-header order, and a tree
    /// of PRIORITY frames.
    #[test]
    fn firefox_shape() {
        let obs = Observation {
            settings: vec![(1, 65536), (4, 131072), (5, 16384)],
            window_update: Some(12517377),
            priorities: vec![
                prio(3, false, 0, 201),
                prio(5, false, 0, 101),
                prio(7, false, 0, 1),
                prio(9, false, 7, 1),
                prio(11, false, 3, 1),
                prio(13, false, 0, 241),
            ],
            pseudo_header_order: vec!['m', 'p', 'a', 's'],
            ..Default::default()
        };
        assert_eq!(
            fingerprint(&obs),
            "1:65536;4:131072;5:16384|12517377|3:0:0:201,5:0:0:101,7:0:0:1,9:0:7:1,11:0:3:1,13:0:0:241|m,p,a,s"
        );
    }

    #[test]
    fn absent_fields_use_sentinels() {
        let obs = Observation {
            settings: vec![],
            window_update: None,
            priorities: vec![],
            pseudo_header_order: vec![],
            ..Default::default()
        };
        assert_eq!(fingerprint(&obs), "|00|0|");
    }

    #[test]
    fn exclusive_bit_renders_as_one() {
        let obs = Observation {
            priorities: vec![prio(15, true, 13, 42)],
            ..Default::default()
        };
        assert!(fingerprint(&obs).contains("15:1:13:42"));
    }

    #[test]
    fn pseudo_letters() {
        assert_eq!(pseudo_letter(":method"), Some('m'));
        assert_eq!(pseudo_letter(":authority"), Some('a'));
        assert_eq!(pseudo_letter(":scheme"), Some('s'));
        assert_eq!(pseudo_letter(":path"), Some('p'));
        assert_eq!(pseudo_letter("user-agent"), None);
        assert_eq!(pseudo_letter(":status"), None);
    }

    #[test]
    fn hash_is_md5_of_fingerprint() {
        let fp = "1:65536;2:0;3:1000;4:6291456;6:262144|15663105|0|m,a,s,p";
        assert_eq!(hash(fp), hex::encode(Md5::digest(fp.as_bytes())));
    }

    /// Settings order is load-bearing: the same values in a different order
    /// must produce a different fingerprint.
    #[test]
    fn settings_order_changes_fingerprint() {
        let a = Observation {
            settings: vec![(1, 65536), (2, 0)],
            ..Default::default()
        };
        let b = Observation {
            settings: vec![(2, 0), (1, 65536)],
            ..Default::default()
        };
        assert_ne!(fingerprint(&a), fingerprint(&b));
    }
}
