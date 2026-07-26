//! A stream that replays already-read bytes before reading from the socket.
//!
//! We have to consume the ClientHello off the wire to fingerprint it, but rustls
//! then needs to see those same bytes to perform the handshake. Rather than
//! poll `TcpStream::peek` in a loop — which busy-spins whenever the hello is
//! split across segments — we read normally into a buffer and hand rustls a
//! stream that yields the buffer first and the socket afterwards.

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

pub struct PrefixedStream<S> {
    prefix: Vec<u8>,
    pos: usize,
    inner: S,
}

impl<S> PrefixedStream<S> {
    pub fn new(prefix: Vec<u8>, inner: S) -> Self {
        PrefixedStream {
            prefix,
            pos: 0,
            inner,
        }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for PrefixedStream<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        // Drain the replay buffer first. Note we return after a partial fill
        // rather than topping up from the socket: a short read is always legal
        // and doing otherwise risks blocking on a socket that has nothing yet.
        if self.pos < self.prefix.len() {
            let remaining = &self.prefix[self.pos..];
            let n = remaining.len().min(buf.remaining());
            buf.put_slice(&remaining[..n]);
            self.pos += n;

            // Release the buffer once drained; a ClientHello is a few KB and
            // the connection may live much longer.
            if self.pos >= self.prefix.len() {
                self.prefix = Vec::new();
                self.pos = 0;
            }
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for PrefixedStream<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    #[tokio::test]
    async fn replays_prefix_then_inner() {
        let inner = std::io::Cursor::new(b"world".to_vec());
        let mut s = PrefixedStream::new(b"hello ".to_vec(), inner);

        let mut out = Vec::new();
        s.read_to_end(&mut out).await.unwrap();
        assert_eq!(out, b"hello world");
    }

    #[tokio::test]
    async fn handles_reads_smaller_than_the_prefix() {
        let inner = std::io::Cursor::new(b"XY".to_vec());
        let mut s = PrefixedStream::new(b"abcd".to_vec(), inner);

        let mut buf = [0u8; 3];
        let n = s.read(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], b"abc");

        let mut rest = Vec::new();
        s.read_to_end(&mut rest).await.unwrap();
        assert_eq!(rest, b"dXY");
    }

    #[tokio::test]
    async fn empty_prefix_is_transparent() {
        let inner = std::io::Cursor::new(b"just this".to_vec());
        let mut s = PrefixedStream::new(Vec::new(), inner);

        let mut out = Vec::new();
        s.read_to_end(&mut out).await.unwrap();
        assert_eq!(out, b"just this");
    }
}
