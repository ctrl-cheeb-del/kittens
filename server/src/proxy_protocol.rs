//! PROXY protocol (v1 and v2), for recovering the real client address.
//!
//! Fly's raw TCP passthrough hands us a connection from its own internal
//! proxy, so without this every visitor looks like 172.16.x.x. That breaks two
//! things: the reported IP is wrong, and the per-IP rate limiter degenerates
//! into one shared bucket for the whole internet, which is exactly the
//! protection you want during a flood.
//!
//! Enabling `proxy_proto` on the Fly service prefixes each connection with a
//! header naming the true source. TLS bytes follow untouched, so the
//! ClientHello is unaffected.
//!
//! **Only ever parse this from a trusted peer.** A client that can reach the
//! port directly could otherwise claim any source address it likes and walk
//! straight past the rate limiter, so it is gated behind explicit config.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use anyhow::{bail, Result};
use tokio::io::{AsyncRead, AsyncReadExt};

const V2_SIGNATURE: [u8; 12] = [
    0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A,
];
const V1_PREFIX: &[u8] = b"PROXY ";
/// RFC-defined maximum for a v1 line.
const V1_MAX: usize = 107;

/// What a parsed header told us, and how many bytes it occupied.
pub struct Header {
    /// None for LOCAL / UNSPEC connections, e.g. a health check.
    pub source: Option<SocketAddr>,
    pub consumed: usize,
}

/// Read and consume a PROXY header from the front of `buf`, reading more from
/// `stream` as needed. The bytes after the header stay in `buf`.
pub async fn read<S: AsyncRead + Unpin>(stream: &mut S, buf: &mut Vec<u8>) -> Result<Header> {
    // Identify the variant from the shortest prefix that can distinguish them.
    // Demanding 16 bytes up front would break on a short v1 line such as
    // "PROXY UNKNOWN\r\n", which is 15 bytes and may be the whole connection.
    fill_to(stream, buf, V1_PREFIX.len()).await?;

    let header = if buf.starts_with(V1_PREFIX) {
        // Text form, terminated by CRLF.
        loop {
            if let Some(end) = find_crlf(buf) {
                break parse_v1(&buf[..end + 2])?;
            }
            if buf.len() > V1_MAX {
                bail!("PROXY v1 header exceeds {V1_MAX} bytes");
            }
            let before = buf.len();
            fill_to(stream, buf, before + 1).await?;
        }
    } else {
        fill_to(stream, buf, V2_SIGNATURE.len()).await?;
        if !buf.starts_with(&V2_SIGNATURE) {
            bail!("expected a PROXY protocol header");
        }
        fill_to(stream, buf, 16).await?;
        let len = u16::from_be_bytes([buf[14], buf[15]]) as usize;
        fill_to(stream, buf, 16 + len).await?;
        parse_v2(&buf[..16 + len])?
    };

    buf.drain(..header.consumed);
    Ok(header)
}

async fn fill_to<S: AsyncRead + Unpin>(
    stream: &mut S,
    buf: &mut Vec<u8>,
    want: usize,
) -> Result<()> {
    let mut chunk = [0u8; 256];
    while buf.len() < want {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            bail!("connection closed inside PROXY header");
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    Ok(())
}

fn find_crlf(buf: &[u8]) -> Option<usize> {
    buf.windows(2).position(|w| w == b"\r\n")
}

fn parse_v2(b: &[u8]) -> Result<Header> {
    let ver_cmd = b[12];
    if ver_cmd >> 4 != 2 {
        bail!("unsupported PROXY version {}", ver_cmd >> 4);
    }
    let command = ver_cmd & 0x0f;
    let family = b[13] >> 4;
    let len = u16::from_be_bytes([b[14], b[15]]) as usize;
    let consumed = 16 + len;
    let addr = &b[16..consumed];

    // 0 = LOCAL: the proxy is speaking for itself (health checks), so there is
    // no client address to recover.
    if command == 0 {
        return Ok(Header {
            source: None,
            consumed,
        });
    }
    if command != 1 {
        bail!("unsupported PROXY command {command}");
    }

    let source = match family {
        // AF_INET
        1 if addr.len() >= 12 => {
            let ip = Ipv4Addr::new(addr[0], addr[1], addr[2], addr[3]);
            let port = u16::from_be_bytes([addr[8], addr[9]]);
            Some(SocketAddr::new(IpAddr::V4(ip), port))
        }
        // AF_INET6
        2 if addr.len() >= 36 => {
            let mut octets = [0u8; 16];
            octets.copy_from_slice(&addr[0..16]);
            let port = u16::from_be_bytes([addr[32], addr[33]]);
            Some(SocketAddr::new(IpAddr::V6(Ipv6Addr::from(octets)), port))
        }
        // AF_UNSPEC or a unix socket: nothing usable.
        _ => None,
    };

    Ok(Header { source, consumed })
}

fn parse_v1(line: &[u8]) -> Result<Header> {
    let consumed = line.len();
    let text = std::str::from_utf8(&line[..consumed - 2])?;
    let parts: Vec<&str> = text.split(' ').collect();

    // "PROXY UNKNOWN" carries no addresses.
    if parts.len() < 2 || parts[1] == "UNKNOWN" {
        return Ok(Header {
            source: None,
            consumed,
        });
    }
    if parts.len() < 6 {
        bail!("malformed PROXY v1 header");
    }

    let ip: IpAddr = parts[2].parse()?;
    let port: u16 = parts[4].parse()?;
    Ok(Header {
        source: Some(SocketAddr::new(ip, port)),
        consumed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn v2(family: u8, command: u8, addr: &[u8]) -> Vec<u8> {
        let mut b = V2_SIGNATURE.to_vec();
        b.push(0x20 | command);
        b.push(family << 4 | 1);
        b.extend_from_slice(&(addr.len() as u16).to_be_bytes());
        b.extend_from_slice(addr);
        b
    }

    #[tokio::test]
    async fn v2_ipv4() {
        let mut addr = Vec::new();
        addr.extend_from_slice(&[31, 94, 11, 36]); // source
        addr.extend_from_slice(&[10, 0, 0, 1]); // destination
        addr.extend_from_slice(&51234u16.to_be_bytes());
        addr.extend_from_slice(&443u16.to_be_bytes());

        let mut wire = v2(1, 1, &addr);
        wire.extend_from_slice(b"\x16\x03\x01"); // start of a ClientHello

        let mut buf = Vec::new();
        let mut cur = Cursor::new(wire);
        let h = read(&mut cur, &mut buf).await.unwrap();

        assert_eq!(h.source.unwrap().ip().to_string(), "31.94.11.36");
        assert_eq!(h.source.unwrap().port(), 51234);
        // The TLS bytes must survive untouched for the ClientHello parser.
        assert_eq!(buf, b"\x16\x03\x01");
    }

    #[tokio::test]
    async fn v2_ipv6() {
        let ip: Ipv6Addr = "2a09:8280:1::156:5ac8:0".parse().unwrap();
        let mut addr = Vec::new();
        addr.extend_from_slice(&ip.octets());
        addr.extend_from_slice(&[0u8; 16]);
        addr.extend_from_slice(&4000u16.to_be_bytes());
        addr.extend_from_slice(&443u16.to_be_bytes());

        let mut buf = Vec::new();
        let mut cur = Cursor::new(v2(2, 1, &addr));
        let h = read(&mut cur, &mut buf).await.unwrap();
        assert_eq!(h.source.unwrap().ip(), IpAddr::V6(ip));
    }

    /// LOCAL is what a proxy's own health check looks like; it has no client.
    #[tokio::test]
    async fn v2_local_has_no_source() {
        let mut buf = Vec::new();
        let mut cur = Cursor::new(v2(0, 0, &[]));
        let h = read(&mut cur, &mut buf).await.unwrap();
        assert!(h.source.is_none());
    }

    #[tokio::test]
    async fn v1_text_form() {
        let wire = b"PROXY TCP4 31.94.11.36 10.0.0.1 51234 443\r\n\x16\x03\x01".to_vec();
        let mut buf = Vec::new();
        let mut cur = Cursor::new(wire);
        let h = read(&mut cur, &mut buf).await.unwrap();

        assert_eq!(h.source.unwrap().ip().to_string(), "31.94.11.36");
        assert_eq!(h.source.unwrap().port(), 51234);
        assert_eq!(buf, b"\x16\x03\x01");
    }

    #[tokio::test]
    async fn v1_unknown_has_no_source() {
        let mut buf = Vec::new();
        let mut cur = Cursor::new(b"PROXY UNKNOWN\r\n".to_vec());
        let h = read(&mut cur, &mut buf).await.unwrap();
        assert!(h.source.is_none());
    }

    /// A bare TLS connection must be rejected rather than silently treated as
    /// having no header, or enabling this would make the port spoofable.
    #[tokio::test]
    async fn rejects_a_connection_with_no_header() {
        let mut buf = Vec::new();
        let mut cur = Cursor::new(b"\x16\x03\x01\x02\x00\x01\x00\x01\xfc\x03\x03aaaaaa".to_vec());
        assert!(read(&mut cur, &mut buf).await.is_err());
    }

    #[tokio::test]
    async fn v1_runaway_is_bounded() {
        let mut wire = b"PROXY ".to_vec();
        wire.extend(std::iter::repeat(b'x').take(500));
        let mut buf = Vec::new();
        let mut cur = Cursor::new(wire);
        assert!(read(&mut cur, &mut buf).await.is_err());
    }

    #[tokio::test]
    async fn header_split_across_reads() {
        // Feed the header a byte at a time; it must still reassemble.
        let mut addr = Vec::new();
        addr.extend_from_slice(&[1, 2, 3, 4]);
        addr.extend_from_slice(&[10, 0, 0, 1]);
        addr.extend_from_slice(&1234u16.to_be_bytes());
        addr.extend_from_slice(&443u16.to_be_bytes());
        let wire = v2(1, 1, &addr);

        let (client, mut server) = tokio::io::duplex(64);
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            let (_rx, mut tx) = tokio::io::split(client);
            for b in wire {
                tx.write_all(&[b]).await.unwrap();
                tx.flush().await.unwrap();
            }
        });

        let mut buf = Vec::new();
        let h = read(&mut server, &mut buf).await.unwrap();
        assert_eq!(h.source.unwrap().ip().to_string(), "1.2.3.4");
    }
}
