//! HTTP/2 frame codec (RFC 9113 §4).
//!
//! Only what a fingerprinting endpoint needs: read any frame, write the few we
//! reply with. Deliberately not a general HTTP/2 stack.

use anyhow::{bail, Result};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const PREFACE: &[u8] = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";

pub const DATA: u8 = 0x0;
pub const HEADERS: u8 = 0x1;
pub const PRIORITY: u8 = 0x2;
pub const RST_STREAM: u8 = 0x3;
pub const SETTINGS: u8 = 0x4;
pub const PUSH_PROMISE: u8 = 0x5;
pub const PING: u8 = 0x6;
pub const GOAWAY: u8 = 0x7;
pub const WINDOW_UPDATE: u8 = 0x8;
pub const CONTINUATION: u8 = 0x9;

pub const FLAG_END_STREAM: u8 = 0x1;
pub const FLAG_ACK: u8 = 0x1;
pub const FLAG_END_HEADERS: u8 = 0x4;
pub const FLAG_PADDED: u8 = 0x8;
pub const FLAG_PRIORITY: u8 = 0x20;

/// Cap on a single frame we're willing to buffer. Our advertised
/// SETTINGS_MAX_FRAME_SIZE is 16384; allow some slack, reject the absurd.
const MAX_FRAME: u32 = 1 << 20;

pub fn frame_type_name(t: u8) -> &'static str {
    match t {
        DATA => "DATA",
        HEADERS => "HEADERS",
        PRIORITY => "PRIORITY",
        RST_STREAM => "RST_STREAM",
        SETTINGS => "SETTINGS",
        PUSH_PROMISE => "PUSH_PROMISE",
        PING => "PING",
        GOAWAY => "GOAWAY",
        WINDOW_UPDATE => "WINDOW_UPDATE",
        CONTINUATION => "CONTINUATION",
        _ => "UNKNOWN",
    }
}

/// Names for the settings identifiers we may observe (RFC 9113 §6.5.2 plus
/// RFC 8441's SETTINGS_ENABLE_CONNECT_PROTOCOL and RFC 9218's NO_RFC7540_PRIORITIES).
pub fn setting_name(id: u16) -> &'static str {
    match id {
        0x1 => "HEADER_TABLE_SIZE",
        0x2 => "ENABLE_PUSH",
        0x3 => "MAX_CONCURRENT_STREAMS",
        0x4 => "INITIAL_WINDOW_SIZE",
        0x5 => "MAX_FRAME_SIZE",
        0x6 => "MAX_HEADER_LIST_SIZE",
        0x8 => "ENABLE_CONNECT_PROTOCOL",
        0x9 => "NO_RFC7540_PRIORITIES",
        _ => "UNKNOWN",
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Header {
    pub len: u32,
    pub typ: u8,
    pub flags: u8,
    pub stream_id: u32,
}

impl Header {
    pub fn has(&self, flag: u8) -> bool {
        self.flags & flag != 0
    }
}

/// Priority information, from either a PRIORITY frame or a HEADERS frame that
/// carries the PRIORITY flag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Priority {
    pub stream_id: u32,
    pub exclusive: bool,
    pub depends_on: u32,
    /// Already adjusted: the wire carries weight-1, this is the real weight.
    pub weight: u16,
}

impl Priority {
    /// Decode the 5-byte priority block.
    pub fn parse(stream_id: u32, b: &[u8]) -> Result<Priority> {
        if b.len() < 5 {
            bail!("priority block too short");
        }
        let raw = u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
        Ok(Priority {
            stream_id,
            exclusive: raw & 0x8000_0000 != 0,
            depends_on: raw & 0x7fff_ffff,
            // RFC 9113 §6.3: "a value of 0 ... represents a weight of 1".
            weight: b[4] as u16 + 1,
        })
    }
}

pub async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> Result<(Header, Vec<u8>)> {
    let mut hdr = [0u8; 9];
    r.read_exact(&mut hdr).await?;

    let len = u32::from_be_bytes([0, hdr[0], hdr[1], hdr[2]]);
    let typ = hdr[3];
    let flags = hdr[4];
    // Top bit of the stream identifier is reserved and must be ignored.
    let stream_id = u32::from_be_bytes([hdr[5], hdr[6], hdr[7], hdr[8]]) & 0x7fff_ffff;

    if len > MAX_FRAME {
        bail!("frame too large: {len}");
    }

    let mut payload = vec![0u8; len as usize];
    r.read_exact(&mut payload).await?;

    Ok((
        Header {
            len,
            typ,
            flags,
            stream_id,
        },
        payload,
    ))
}

pub async fn write_frame<W: AsyncWrite + Unpin>(
    w: &mut W,
    typ: u8,
    flags: u8,
    stream_id: u32,
    payload: &[u8],
) -> Result<()> {
    let len = payload.len();
    if len > MAX_FRAME as usize {
        bail!("refusing to write oversized frame");
    }
    let mut hdr = [0u8; 9];
    hdr[0] = (len >> 16) as u8;
    hdr[1] = (len >> 8) as u8;
    hdr[2] = len as u8;
    hdr[3] = typ;
    hdr[4] = flags;
    hdr[5..9].copy_from_slice(&stream_id.to_be_bytes());

    w.write_all(&hdr).await?;
    w.write_all(payload).await?;
    Ok(())
}

/// Parse a SETTINGS payload into (id, value) pairs, preserving wire order —
/// order is part of the Akamai fingerprint.
pub fn parse_settings(payload: &[u8]) -> Result<Vec<(u16, u32)>> {
    if payload.len() % 6 != 0 {
        bail!("SETTINGS payload not a multiple of 6");
    }
    Ok(payload
        .chunks_exact(6)
        .map(|c| {
            (
                u16::from_be_bytes([c[0], c[1]]),
                u32::from_be_bytes([c[2], c[3], c[4], c[5]]),
            )
        })
        .collect())
}

/// Strip padding and priority prefixes from a HEADERS payload, returning the
/// header block fragment plus any priority information it carried.
pub fn split_headers_payload(
    hdr: &Header,
    payload: &[u8],
) -> Result<(Vec<u8>, Option<Priority>)> {
    let mut cur = payload;
    let mut pad_len = 0usize;

    if hdr.has(FLAG_PADDED) {
        if cur.is_empty() {
            bail!("PADDED HEADERS with empty payload");
        }
        pad_len = cur[0] as usize;
        cur = &cur[1..];
    }

    let mut priority = None;
    if hdr.has(FLAG_PRIORITY) {
        if cur.len() < 5 {
            bail!("PRIORITY HEADERS too short");
        }
        priority = Some(Priority::parse(hdr.stream_id, &cur[..5])?);
        cur = &cur[5..];
    }

    if pad_len > cur.len() {
        bail!("padding longer than remaining payload");
    }
    let fragment = &cur[..cur.len() - pad_len];
    Ok((fragment.to_vec(), priority))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn frame_roundtrip() {
        let mut buf = Vec::new();
        write_frame(&mut buf, SETTINGS, 0, 0, &[0, 1, 0, 0, 0x10, 0])
            .await
            .unwrap();

        let mut cur = std::io::Cursor::new(buf);
        let (h, p) = read_frame(&mut cur).await.unwrap();
        assert_eq!(h.typ, SETTINGS);
        assert_eq!(h.len, 6);
        assert_eq!(h.stream_id, 0);
        assert_eq!(parse_settings(&p).unwrap(), vec![(1u16, 0x1000u32)]);
    }

    #[test]
    fn settings_preserve_wire_order() {
        // Chrome's order: 1,2,3,4,6 — not sorted, and that ordering matters.
        let mut payload = Vec::new();
        for (id, val) in [(1u16, 65536u32), (2, 0), (4, 6291456), (3, 1000)] {
            payload.extend_from_slice(&id.to_be_bytes());
            payload.extend_from_slice(&val.to_be_bytes());
        }
        let parsed = parse_settings(&payload).unwrap();
        assert_eq!(
            parsed,
            vec![(1, 65536), (2, 0), (4, 6291456), (3, 1000)],
            "order must survive parsing"
        );
    }

    #[test]
    fn malformed_settings_rejected() {
        assert!(parse_settings(&[0, 1, 0, 0]).is_err());
    }

    #[test]
    fn priority_weight_is_wire_value_plus_one() {
        // Firefox's heaviest placeholder stream: wire byte 200 => weight 201.
        let p = Priority::parse(3, &[0, 0, 0, 0, 200]).unwrap();
        assert_eq!(p.weight, 201);
        assert!(!p.exclusive);
        assert_eq!(p.depends_on, 0);

        // Exclusive bit set, depends on stream 7.
        let p = Priority::parse(9, &[0x80, 0, 0, 7, 0]).unwrap();
        assert!(p.exclusive);
        assert_eq!(p.depends_on, 7);
        assert_eq!(p.weight, 1);
    }

    #[test]
    fn headers_payload_strips_padding_and_priority() {
        let hdr = Header {
            len: 0,
            typ: HEADERS,
            flags: FLAG_PADDED | FLAG_PRIORITY,
            stream_id: 1,
        };
        // pad_len=2, priority(5), fragment "abc", 2 padding bytes
        let payload = [&[2u8][..], &[0, 0, 0, 3, 99][..], b"abc", &[0, 0][..]].concat();

        let (frag, prio) = split_headers_payload(&hdr, &payload).unwrap();
        assert_eq!(frag, b"abc");
        let prio = prio.unwrap();
        assert_eq!(prio.depends_on, 3);
        assert_eq!(prio.weight, 100);
    }

    #[test]
    fn headers_payload_rejects_overlong_padding() {
        let hdr = Header {
            len: 0,
            typ: HEADERS,
            flags: FLAG_PADDED,
            stream_id: 1,
        };
        // Claims 200 bytes of padding but only 3 follow.
        assert!(split_headers_payload(&hdr, &[200, 1, 2, 3]).is_err());
    }

    #[tokio::test]
    async fn oversized_frame_rejected() {
        // Declares a 2 MiB frame; we must bail before allocating it.
        let hdr = [0x20u8, 0x00, 0x00, DATA, 0, 0, 0, 0, 1];
        let mut cur = std::io::Cursor::new(hdr.to_vec());
        assert!(read_frame(&mut cur).await.is_err());
    }
}
