//! Hand-rolled ClientHello parser.
//!
//! rustls deliberately does not expose the extension list in wire order, and
//! order is the entire basis of JA3/JA4. So we parse the ClientHello ourselves
//! off the raw bytes before handing the (unconsumed) stream to rustls for the
//! actual handshake.
//!
//! Everything here runs on untrusted input from the open internet: no slicing
//! without a length check, no panics.

use anyhow::{bail, Result};

/// A value is GREASE (RFC 8701) if both bytes are equal and the low nibble is
/// 0xa — 0x0a0a, 0x1a1a, ... 0xfafa. Clients inject these at random to keep
/// middleboxes honest, so every fingerprint must filter them out or the hash
/// would differ on every connection.
pub fn is_grease(v: u16) -> bool {
    (v >> 8) == (v & 0xff) && (v & 0x0f) == 0x0a
}

// Extension type numbers we look inside of.
pub const EXT_SERVER_NAME: u16 = 0x0000;
pub const EXT_EC_POINT_FORMATS: u16 = 0x000b;
pub const EXT_SUPPORTED_GROUPS: u16 = 0x000a;
pub const EXT_SIGNATURE_ALGORITHMS: u16 = 0x000d;
pub const EXT_ALPN: u16 = 0x0010;
pub const EXT_PADDING: u16 = 0x0015;
pub const EXT_COMPRESS_CERTIFICATE: u16 = 0x001b;
pub const EXT_RECORD_SIZE_LIMIT: u16 = 0x001c;
pub const EXT_SUPPORTED_VERSIONS: u16 = 0x002b;
pub const EXT_PSK_KEY_EXCHANGE_MODES: u16 = 0x002d;
pub const EXT_KEY_SHARE: u16 = 0x0033;
pub const EXT_APPLICATION_SETTINGS: u16 = 0x4469; // ALPS, Chrome
pub const EXT_APPLICATION_SETTINGS_OLD: u16 = 0x4468;

/// A single extension, retained in the order it appeared on the wire.
#[derive(Debug, Clone)]
pub struct Extension {
    pub typ: u16,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Default)]
pub struct ClientHello {
    /// The legacy `client_version` field. For any modern client this reads
    /// 0x0303 (TLS 1.2) regardless of real capability — the truth lives in the
    /// supported_versions extension. JA3 nonetheless hashes this field.
    pub legacy_version: u16,
    pub random: Vec<u8>,
    pub session_id: Vec<u8>,
    pub cipher_suites: Vec<u16>,
    pub compression_methods: Vec<u8>,
    pub extensions: Vec<Extension>,

    // Fields decoded out of individual extensions.
    pub server_name: Option<String>,
    /// Raw ALPN protocol IDs. Kept as bytes rather than String because JA4
    /// falls back to a hex representation when the first or last byte isn't
    /// ASCII alphanumeric, and a lossy UTF-8 conversion would destroy that.
    pub alpn: Vec<Vec<u8>>,
    pub supported_groups: Vec<u16>,
    pub ec_point_formats: Vec<u8>,
    pub signature_algorithms: Vec<u16>,
    pub supported_versions: Vec<u16>,
    pub psk_key_exchange_modes: Vec<u8>,
    pub key_share_groups: Vec<u16>,
    pub cert_compression_algs: Vec<u16>,
    pub record_size_limit: Option<u16>,
    pub application_settings: Vec<Vec<u8>>,
}

impl ClientHello {
    /// ALPN values rendered for display/JSON. Lossy by design — the exact bytes
    /// are preserved in `alpn` for fingerprinting.
    pub fn alpn_strings(&self) -> Vec<String> {
        self.alpn
            .iter()
            .map(|p| String::from_utf8_lossy(p).to_string())
            .collect()
    }

    pub fn application_settings_strings(&self) -> Vec<String> {
        self.application_settings
            .iter()
            .map(|p| String::from_utf8_lossy(p).to_string())
            .collect()
    }

    /// Extension types in wire order, GREASE stripped.
    pub fn extension_types(&self) -> Vec<u16> {
        self.extensions
            .iter()
            .map(|e| e.typ)
            .filter(|t| !is_grease(*t))
            .collect()
    }

    /// Cipher suites in wire order, GREASE stripped.
    pub fn ciphers_no_grease(&self) -> Vec<u16> {
        self.cipher_suites
            .iter()
            .copied()
            .filter(|c| !is_grease(*c))
            .collect()
    }

    /// The negotiable TLS version: highest non-GREASE entry of
    /// supported_versions, falling back to the legacy field.
    pub fn effective_version(&self) -> u16 {
        self.supported_versions
            .iter()
            .copied()
            .filter(|v| !is_grease(*v))
            .max()
            .unwrap_or(self.legacy_version)
    }
}

/// Bounds-checked cursor. Every read returns Result; nothing panics.
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Reader { buf, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.pos)
    }

    fn is_empty(&self) -> bool {
        self.remaining() == 0
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if self.remaining() < n {
            bail!("short read: want {n}, have {}", self.remaining());
        }
        let s = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }

    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16> {
        let b = self.take(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }

    fn u24(&mut self) -> Result<u32> {
        let b = self.take(3)?;
        Ok(u32::from_be_bytes([0, b[0], b[1], b[2]]))
    }

    /// A vector with a single-byte length prefix.
    fn vec8(&mut self) -> Result<&'a [u8]> {
        let n = self.u8()? as usize;
        self.take(n)
    }

    /// A vector with a two-byte length prefix.
    fn vec16(&mut self) -> Result<&'a [u8]> {
        let n = self.u16()? as usize;
        self.take(n)
    }

    /// Read the remainder as a list of u16s. Trailing odd byte is an error.
    fn u16_list(&mut self) -> Result<Vec<u16>> {
        if self.remaining() % 2 != 0 {
            bail!("u16 list with odd length");
        }
        let mut out = Vec::with_capacity(self.remaining() / 2);
        while !self.is_empty() {
            out.push(self.u16()?);
        }
        Ok(out)
    }
}

/// Outcome of trying to parse a buffer that may still be filling up.
#[derive(Debug)]
pub enum ParseOutcome {
    /// A complete ClientHello was decoded.
    Complete(Box<ClientHello>),
    /// Bytes so far are valid but truncated; read more and retry.
    NeedMore,
}

/// Reassemble handshake bytes from one or more TLS records, then parse.
///
/// A ClientHello is usually a single record but is permitted to be fragmented
/// across several, so we concatenate handshake-type records before decoding.
pub fn parse_from_records(buf: &[u8]) -> Result<ParseOutcome> {
    let mut handshake = Vec::new();
    let mut r = Reader::new(buf);

    loop {
        if r.remaining() < 5 {
            return Ok(ParseOutcome::NeedMore);
        }
        // Peek the record header without consuming, so NeedMore can retry cleanly.
        let hdr = &r.buf[r.pos..r.pos + 5];
        let content_type = hdr[0];
        let len = u16::from_be_bytes([hdr[3], hdr[4]]) as usize;

        if content_type != 0x16 {
            // Not a handshake record. If the very first byte isn't 0x16 this is
            // almost always a plaintext HTTP request sent to the TLS port.
            bail!("not a TLS handshake record (content type 0x{content_type:02x})");
        }
        if len > 16640 {
            bail!("oversized TLS record: {len}");
        }
        if r.remaining() < 5 + len {
            return Ok(ParseOutcome::NeedMore);
        }

        r.pos += 5;
        handshake.extend_from_slice(r.take(len)?);

        // Do we have a whole handshake message yet?
        if handshake.len() >= 4 {
            let msg_len = u32::from_be_bytes([0, handshake[1], handshake[2], handshake[3]]) as usize;
            if handshake.len() >= 4 + msg_len {
                return parse_handshake(&handshake[..4 + msg_len]).map(|ch| ParseOutcome::Complete(Box::new(ch)));
            }
        }
        // Otherwise loop for the next record fragment.
    }
}

/// Parse a complete handshake message that must be a ClientHello.
fn parse_handshake(msg: &[u8]) -> Result<ClientHello> {
    let mut r = Reader::new(msg);

    let msg_type = r.u8()?;
    if msg_type != 0x01 {
        bail!("handshake message is not a ClientHello (type {msg_type})");
    }
    let body_len = r.u24()? as usize;
    let body = r.take(body_len)?;

    let mut r = Reader::new(body);
    let mut ch = ClientHello {
        legacy_version: r.u16()?,
        random: r.take(32)?.to_vec(),
        session_id: r.vec8()?.to_vec(),
        ..Default::default()
    };

    let ciphers = r.vec16()?;
    ch.cipher_suites = Reader::new(ciphers).u16_list()?;
    ch.compression_methods = r.vec8()?.to_vec();

    // Extensions are optional in the grammar (SSLv3-era clients omit them).
    if r.is_empty() {
        return Ok(ch);
    }

    let ext_block = r.vec16()?;
    let mut er = Reader::new(ext_block);
    while !er.is_empty() {
        let typ = er.u16()?;
        let data = er.vec16()?.to_vec();
        decode_extension(&mut ch, typ, &data)?;
        ch.extensions.push(Extension { typ, data });
    }

    Ok(ch)
}

/// Pull the interesting contents out of extensions we understand.
///
/// A malformed body in a single extension is tolerated (we keep the raw bytes
/// and move on) — a client sending us garbage in one extension shouldn't cost
/// us the whole fingerprint.
fn decode_extension(ch: &mut ClientHello, typ: u16, data: &[u8]) -> Result<()> {
    match typ {
        EXT_SERVER_NAME => {
            let mut r = Reader::new(data);
            if let Ok(list) = r.vec16() {
                let mut lr = Reader::new(list);
                while !lr.is_empty() {
                    let name_type = match lr.u8() {
                        Ok(t) => t,
                        Err(_) => break,
                    };
                    let Ok(host) = lr.vec16() else { break };
                    if name_type == 0 {
                        ch.server_name = Some(String::from_utf8_lossy(host).to_string());
                        break;
                    }
                }
            }
        }
        EXT_ALPN => {
            let mut r = Reader::new(data);
            if let Ok(list) = r.vec16() {
                let mut lr = Reader::new(list);
                while !lr.is_empty() {
                    let Ok(proto) = lr.vec8() else { break };
                    ch.alpn.push(proto.to_vec());
                }
            }
        }
        EXT_SUPPORTED_GROUPS => {
            let mut r = Reader::new(data);
            if let Ok(list) = r.vec16() {
                ch.supported_groups = Reader::new(list).u16_list().unwrap_or_default();
            }
        }
        EXT_EC_POINT_FORMATS => {
            let mut r = Reader::new(data);
            if let Ok(list) = r.vec8() {
                ch.ec_point_formats = list.to_vec();
            }
        }
        EXT_SIGNATURE_ALGORITHMS => {
            let mut r = Reader::new(data);
            if let Ok(list) = r.vec16() {
                ch.signature_algorithms = Reader::new(list).u16_list().unwrap_or_default();
            }
        }
        EXT_SUPPORTED_VERSIONS => {
            let mut r = Reader::new(data);
            if let Ok(list) = r.vec8() {
                ch.supported_versions = Reader::new(list).u16_list().unwrap_or_default();
            }
        }
        EXT_PSK_KEY_EXCHANGE_MODES => {
            let mut r = Reader::new(data);
            if let Ok(list) = r.vec8() {
                ch.psk_key_exchange_modes = list.to_vec();
            }
        }
        EXT_KEY_SHARE => {
            // Only the group IDs matter for fingerprinting; the public keys are
            // per-connection random and deliberately ignored.
            let mut r = Reader::new(data);
            if let Ok(list) = r.vec16() {
                let mut lr = Reader::new(list);
                while !lr.is_empty() {
                    let Ok(group) = lr.u16() else { break };
                    if lr.vec16().is_err() {
                        break;
                    }
                    ch.key_share_groups.push(group);
                }
            }
        }
        EXT_COMPRESS_CERTIFICATE => {
            let mut r = Reader::new(data);
            if let Ok(list) = r.vec8() {
                ch.cert_compression_algs = Reader::new(list).u16_list().unwrap_or_default();
            }
        }
        EXT_RECORD_SIZE_LIMIT => {
            if data.len() >= 2 {
                ch.record_size_limit = Some(u16::from_be_bytes([data[0], data[1]]));
            }
        }
        EXT_APPLICATION_SETTINGS | EXT_APPLICATION_SETTINGS_OLD => {
            let mut r = Reader::new(data);
            if let Ok(list) = r.vec16() {
                let mut lr = Reader::new(list);
                while !lr.is_empty() {
                    let Ok(proto) = lr.vec8() else { break };
                    ch.application_settings.push(proto.to_vec());
                }
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grease_detection() {
        for b in 0u16..16 {
            let v = (b << 12) | (0x0a << 8) | (b << 4) | 0x0a;
            assert!(is_grease(v), "0x{v:04x} should be GREASE");
        }
        // Real values that must not be mistaken for GREASE.
        for v in [0x1301, 0x1302, 0xc02b, 0x0a0b, 0x2a3a, 0x0000, 0x002b] {
            assert!(!is_grease(v), "0x{v:04x} should not be GREASE");
        }
    }

    /// Build a minimal but well-formed ClientHello for parser tests.
    fn synth_client_hello() -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(&[0x03, 0x03]); // legacy_version TLS 1.2
        body.extend_from_slice(&[0x11; 32]); // random
        body.push(0); // empty session id

        // cipher suites: GREASE, TLS_AES_128_GCM_SHA256, TLS_AES_256_GCM_SHA384
        let ciphers: [u16; 3] = [0x0a0a, 0x1301, 0x1302];
        body.extend_from_slice(&((ciphers.len() * 2) as u16).to_be_bytes());
        for c in ciphers {
            body.extend_from_slice(&c.to_be_bytes());
        }

        body.push(1); // compression methods length
        body.push(0); // null compression

        // Extensions: SNI, supported_groups, ALPN, sig_algs, supported_versions
        let mut exts: Vec<u8> = Vec::new();

        let host = b"kittens.sh";
        let mut sni = Vec::new();
        sni.push(0u8); // name type host_name
        sni.extend_from_slice(&(host.len() as u16).to_be_bytes());
        sni.extend_from_slice(host);
        let mut sni_ext = Vec::new();
        sni_ext.extend_from_slice(&(sni.len() as u16).to_be_bytes());
        sni_ext.extend_from_slice(&sni);
        push_ext(&mut exts, EXT_SERVER_NAME, &sni_ext);

        let mut groups = Vec::new();
        let group_ids: [u16; 2] = [0x001d, 0x0017];
        groups.extend_from_slice(&((group_ids.len() * 2) as u16).to_be_bytes());
        for g in group_ids {
            groups.extend_from_slice(&g.to_be_bytes());
        }
        push_ext(&mut exts, EXT_SUPPORTED_GROUPS, &groups);

        let mut alpn_inner = Vec::new();
        for p in [b"h2".as_slice(), b"http/1.1".as_slice()] {
            alpn_inner.push(p.len() as u8);
            alpn_inner.extend_from_slice(p);
        }
        let mut alpn = Vec::new();
        alpn.extend_from_slice(&(alpn_inner.len() as u16).to_be_bytes());
        alpn.extend_from_slice(&alpn_inner);
        push_ext(&mut exts, EXT_ALPN, &alpn);

        let mut sigs = Vec::new();
        let sig_ids: [u16; 2] = [0x0403, 0x0804];
        sigs.extend_from_slice(&((sig_ids.len() * 2) as u16).to_be_bytes());
        for s in sig_ids {
            sigs.extend_from_slice(&s.to_be_bytes());
        }
        push_ext(&mut exts, EXT_SIGNATURE_ALGORITHMS, &sigs);

        let mut vers = Vec::new();
        vers.push(4u8); // 2 versions
        vers.extend_from_slice(&0x0a0au16.to_be_bytes()); // GREASE
        vers.extend_from_slice(&0x0304u16.to_be_bytes()); // TLS 1.3
        push_ext(&mut exts, EXT_SUPPORTED_VERSIONS, &vers);

        body.extend_from_slice(&(exts.len() as u16).to_be_bytes());
        body.extend_from_slice(&exts);

        // Wrap in handshake header, then a TLS record.
        let mut hs = Vec::new();
        hs.push(0x01);
        hs.extend_from_slice(&(body.len() as u32).to_be_bytes()[1..]);
        hs.extend_from_slice(&body);

        let mut rec = Vec::new();
        rec.push(0x16);
        rec.extend_from_slice(&[0x03, 0x01]);
        rec.extend_from_slice(&(hs.len() as u16).to_be_bytes());
        rec.extend_from_slice(&hs);
        rec
    }

    fn push_ext(out: &mut Vec<u8>, typ: u16, data: &[u8]) {
        out.extend_from_slice(&typ.to_be_bytes());
        out.extend_from_slice(&(data.len() as u16).to_be_bytes());
        out.extend_from_slice(data);
    }

    fn parse_ok(bytes: &[u8]) -> ClientHello {
        match parse_from_records(bytes).expect("parse should succeed") {
            ParseOutcome::Complete(ch) => *ch,
            ParseOutcome::NeedMore => panic!("expected a complete ClientHello"),
        }
    }

    #[test]
    fn parses_synthetic_client_hello() {
        let ch = parse_ok(&synth_client_hello());

        assert_eq!(ch.legacy_version, 0x0303);
        assert_eq!(ch.cipher_suites, vec![0x0a0a, 0x1301, 0x1302]);
        assert_eq!(ch.ciphers_no_grease(), vec![0x1301, 0x1302]);
        assert_eq!(ch.server_name.as_deref(), Some("kittens.sh"));
        assert_eq!(ch.alpn_strings(), vec!["h2".to_string(), "http/1.1".to_string()]);
        assert_eq!(ch.supported_groups, vec![0x001d, 0x0017]);
        assert_eq!(ch.signature_algorithms, vec![0x0403, 0x0804]);
        // GREASE is retained in the raw list but excluded from effective_version.
        assert_eq!(ch.supported_versions, vec![0x0a0a, 0x0304]);
        assert_eq!(ch.effective_version(), 0x0304);
    }

    #[test]
    fn preserves_extension_order() {
        let ch = parse_ok(&synth_client_hello());
        assert_eq!(
            ch.extension_types(),
            vec![
                EXT_SERVER_NAME,
                EXT_SUPPORTED_GROUPS,
                EXT_ALPN,
                EXT_SIGNATURE_ALGORITHMS,
                EXT_SUPPORTED_VERSIONS,
            ]
        );
    }

    #[test]
    fn truncated_input_asks_for_more_rather_than_failing() {
        let full = synth_client_hello();
        for cut in [1, 3, 5, 20, 60, full.len() - 1] {
            match parse_from_records(&full[..cut]) {
                Ok(ParseOutcome::NeedMore) => {}
                other => panic!(
                    "cut at {cut} should need more, got {}",
                    match other {
                        Ok(ParseOutcome::Complete(_)) => "Complete".to_string(),
                        Ok(ParseOutcome::NeedMore) => unreachable!(),
                        Err(e) => format!("Err({e})"),
                    }
                ),
            }
        }
    }

    #[test]
    fn plaintext_http_is_rejected_cleanly() {
        let err = parse_from_records(b"GET / HTTP/1.1\r\nHost: kittens.sh\r\n\r\n")
            .expect_err("plaintext must be rejected");
        assert!(err.to_string().contains("not a TLS handshake record"));
    }

    /// Fuzz-lite: no truncation or byte flip may panic.
    #[test]
    fn never_panics_on_corrupt_input() {
        let full = synth_client_hello();
        for i in 0..full.len() {
            let _ = parse_from_records(&full[..i]);
            let mut m = full.clone();
            m[i] ^= 0xff;
            let _ = parse_from_records(&m);
        }
    }
}
