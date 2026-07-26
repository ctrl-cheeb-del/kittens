//! A minimal HTTP/2 server, written specifically to preserve what a general
//! HTTP/2 library throws away.
//!
//! This endpoint only ever answers small GETs with JSON, so implementing the
//! protocol directly is less code than fighting `h2` to recover SETTINGS order,
//! WINDOW_UPDATE size, PRIORITY frames and pseudo-header order — all of which
//! are inputs to the Akamai fingerprint and all of which a normal stack
//! discards on the way to handing you a parsed `Request`.
//!
//! Deliberately unimplemented: flow control accounting (our replies are far
//! under any sane window), server push, and stream prioritisation.

use anyhow::{bail, Context, Result};
use fluke_hpack::{Decoder, Encoder};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};

use super::akamai::{self, Observation};
use super::frame::{self, Header, Priority};
use crate::http::Response;

/// A request as it arrived, with ordering intact.
#[derive(Debug, Clone, Default)]
pub struct Request {
    pub stream_id: u32,
    /// Every header in wire order, pseudo-headers included.
    pub headers: Vec<(String, String)>,
    /// Priority carried on the HEADERS frame itself, if any.
    pub headers_priority: Option<Priority>,
}

impl Request {
    pub fn get(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub fn method(&self) -> &str {
        self.get(":method").unwrap_or("GET")
    }

    pub fn path(&self) -> &str {
        self.get(":path").unwrap_or("/")
    }
}

/// Settings we advertise. Modest and unremarkable on purpose — a client
/// shouldn't have to work around us to produce its natural fingerprint.
const OUR_SETTINGS: &[(u16, u32)] = &[
    (0x3, 250),    // MAX_CONCURRENT_STREAMS
    (0x4, 65535),  // INITIAL_WINDOW_SIZE
    (0x5, 16384),  // MAX_FRAME_SIZE
];

/// Guard against a client that opens a connection and floods frames without
/// ever making a request. Reset each time a request is dispatched, so a busy
/// page load is never mistaken for an attack.
const MAX_IDLE_FRAMES: usize = 512;

/// RFC 9113 defaults, used until the peer's SETTINGS say otherwise.
const DEFAULT_MAX_FRAME: usize = 16_384;
const DEFAULT_WINDOW: i64 = 65_535;

/// The peer's receive limits. Exceeding either is a connection error, so a
/// browser will simply drop us — which is what happens if you send a 54 KB
/// asset as one unmetered DATA frame.
struct Peer {
    max_frame_size: usize,
    initial_window: i64,
    conn_window: i64,
}

impl Default for Peer {
    fn default() -> Self {
        Peer {
            max_frame_size: DEFAULT_MAX_FRAME,
            initial_window: DEFAULT_WINDOW,
            conn_window: DEFAULT_WINDOW,
        }
    }
}

/// A response body still being metered out under flow control.
struct Body {
    stream_id: u32,
    data: Vec<u8>,
    sent: usize,
    window: i64,
}

/// Emit as much of each queued body as the peer's windows and frame size
/// currently permit. Called before every read, so WINDOW_UPDATEs arriving on
/// the read side immediately unblock more output.
async fn flush_bodies<S>(
    stream: &mut S,
    bodies: &mut std::collections::VecDeque<Body>,
    peer: &mut Peer,
) -> Result<()>
where
    S: AsyncWrite + Unpin,
{
    let mut wrote = false;

    for body in bodies.iter_mut() {
        loop {
            let remaining = body.data.len() - body.sent;
            if remaining == 0 {
                break;
            }
            let allowed = peer
                .conn_window
                .min(body.window)
                .min(peer.max_frame_size as i64)
                .min(remaining as i64);
            if allowed <= 0 {
                break; // wait for a WINDOW_UPDATE
            }
            let n = allowed as usize;
            let end = body.sent + n == body.data.len();
            frame::write_frame(
                stream,
                frame::DATA,
                if end { frame::FLAG_END_STREAM } else { 0 },
                body.stream_id,
                &body.data[body.sent..body.sent + n],
            )
            .await?;
            body.sent += n;
            body.window -= n as i64;
            peer.conn_window -= n as i64;
            wrote = true;
        }
    }

    bodies.retain(|b| b.sent < b.data.len());
    if wrote {
        stream.flush().await?;
    }
    Ok(())
}

pub async fn serve<S, F>(stream: &mut S, mut respond: F) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
    F: FnMut(&Request, &Observation) -> Response,
{
    // The client preface arrives first; ALPN already told us to expect h2.
    let mut preface = [0u8; 24];
    tokio::io::AsyncReadExt::read_exact(stream, &mut preface)
        .await
        .context("reading HTTP/2 client preface")?;
    if preface != frame::PREFACE {
        bail!("bad HTTP/2 preface");
    }

    // Our own preface: a SETTINGS frame, which must be first.
    let mut settings_payload = Vec::new();
    for (id, val) in OUR_SETTINGS {
        settings_payload.extend_from_slice(&id.to_be_bytes());
        settings_payload.extend_from_slice(&val.to_be_bytes());
    }
    frame::write_frame(stream, frame::SETTINGS, 0, 0, &settings_payload).await?;
    stream.flush().await?;

    let mut obs = Observation::default();
    let mut decoder = Decoder::new();
    let mut encoder = Encoder::new();

    // HEADERS may be split across CONTINUATION frames; accumulate until
    // END_HEADERS before handing the block to HPACK.
    let mut pending: Option<(Header, Vec<u8>, Option<Priority>)> = None;
    let mut idle_frames = 0usize;
    let mut peer = Peer::default();
    let mut bodies: std::collections::VecDeque<Body> = std::collections::VecDeque::new();

    loop {
        // Push out whatever the current windows allow before blocking on the
        // next frame; that next frame is often the WINDOW_UPDATE that lets the
        // rest of a large asset through.
        flush_bodies(stream, &mut bodies, &mut peer).await?;

        let (hdr, payload) = match frame::read_frame(stream).await {
            Ok(f) => f,
            // A closed connection is the normal way a browser finishes.
            Err(_) => return Ok(()),
        };

        idle_frames += 1;
        if idle_frames > MAX_IDLE_FRAMES {
            bail!("too many frames without a request");
        }

        // A CONTINUATION must immediately follow its HEADERS.
        if let Some((_, ref mut block, _)) = pending {
            if hdr.typ != frame::CONTINUATION {
                bail!("expected CONTINUATION, got {}", frame::frame_type_name(hdr.typ));
            }
            block.extend_from_slice(&payload);
            if !hdr.has(frame::FLAG_END_HEADERS) {
                continue;
            }
            let (h, block, prio) = pending.take().expect("checked above");
            idle_frames = 0;
            dispatch(
                stream, &h, &block, prio, &mut decoder, &mut encoder, &mut obs, &mut respond,
                &mut bodies, &peer,
            )
            .await?;
            continue;
        }

        match hdr.typ {
            frame::SETTINGS => {
                if hdr.has(frame::FLAG_ACK) {
                    continue; // acknowledgement of ours; carries no payload
                }
                let settings = frame::parse_settings(&payload)?;

                // Only the first SETTINGS defines the fingerprint. A client may
                // send more later; recording those would corrupt it.
                if obs.settings.is_empty() {
                    obs.settings = settings.clone();
                }

                // These are limits on what we may send, not decoration.
                for (id, value) in &settings {
                    match id {
                        0x4 => {
                            // RFC 9113 6.9.2: a change to INITIAL_WINDOW_SIZE
                            // shifts every open stream's window by the delta.
                            let delta = *value as i64 - peer.initial_window;
                            peer.initial_window = *value as i64;
                            for b in bodies.iter_mut() {
                                b.window += delta;
                            }
                        }
                        0x5 => {
                            let v = (*value as usize).clamp(16_384, 16_777_215);
                            peer.max_frame_size = v;
                        }
                        _ => {}
                    }
                }
                frame::write_frame(stream, frame::SETTINGS, frame::FLAG_ACK, 0, &[]).await?;
                stream.flush().await?;
            }
            frame::WINDOW_UPDATE => {
                if payload.len() < 4 {
                    bail!("short WINDOW_UPDATE");
                }
                let inc =
                    u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]])
                        & 0x7fff_ffff;

                if hdr.stream_id == 0 {
                    // Only the first connection-level update is fingerprinted.
                    if obs.window_update.is_none() {
                        obs.window_update = Some(inc);
                    }
                    peer.conn_window += inc as i64;
                } else if let Some(b) =
                    bodies.iter_mut().find(|b| b.stream_id == hdr.stream_id)
                {
                    b.window += inc as i64;
                }
            }
            frame::PRIORITY => {
                if let Ok(p) = Priority::parse(hdr.stream_id, &payload) {
                    obs.priorities.push(p);
                }
            }
            frame::PING => {
                if !hdr.has(frame::FLAG_ACK) {
                    frame::write_frame(stream, frame::PING, frame::FLAG_ACK, 0, &payload).await?;
                    stream.flush().await?;
                }
            }
            frame::GOAWAY => return Ok(()),
            frame::HEADERS => {
                let (block, prio) = frame::split_headers_payload(&hdr, &payload)?;
                if hdr.has(frame::FLAG_END_HEADERS) {
                    idle_frames = 0;
                    dispatch(
                        stream, &hdr, &block, prio, &mut decoder, &mut encoder, &mut obs,
                        &mut respond, &mut bodies, &peer,
                    )
                    .await?;
                } else {
                    pending = Some((hdr, block, prio));
                }
            }
            // DATA on a GET, RST_STREAM, and anything unrecognised: ignore.
            // RFC 9113 requires unknown frame types be discarded.
            _ => {}
        }
    }
}

/// Decode a complete header block, build the fingerprint, and reply.
#[allow(clippy::too_many_arguments)]
async fn dispatch<S, F>(
    stream: &mut S,
    hdr: &Header,
    block: &[u8],
    headers_priority: Option<Priority>,
    decoder: &mut Decoder<'_>,
    encoder: &mut Encoder<'_>,
    obs: &mut Observation,
    respond: &mut F,
    bodies: &mut std::collections::VecDeque<Body>,
    peer: &Peer,
) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
    F: FnMut(&Request, &Observation) -> Response,
{
    let decoded = decoder
        .decode(block)
        .map_err(|e| anyhow::anyhow!("HPACK decode failed: {e:?}"))?;

    let headers: Vec<(String, String)> = decoded
        .into_iter()
        .map(|(k, v)| {
            (
                String::from_utf8_lossy(&k).to_string(),
                String::from_utf8_lossy(&v).to_string(),
            )
        })
        .collect();

    // Pseudo-header order comes from the first request on the connection;
    // it's a property of the client, not of the individual stream.
    if obs.pseudo_header_order.is_empty() {
        obs.pseudo_header_order = headers
            .iter()
            .filter_map(|(k, _)| akamai::pseudo_letter(k))
            .collect();
    }

    let req = Request {
        stream_id: hdr.stream_id,
        headers,
        headers_priority,
    };

    let resp = respond(&req, obs);
    write_response(stream, encoder, hdr.stream_id, &resp, bodies, peer).await
}

/// Send the response headers, then queue the body for flow-controlled delivery.
///
/// The body is deliberately *not* written here. It has to be metered against
/// the peer's connection and stream windows and split to its maximum frame
/// size, and the WINDOW_UPDATEs that permit later chunks only arrive on the
/// read side — so the main loop drains the queue instead.
async fn write_response<S>(
    stream: &mut S,
    encoder: &mut Encoder<'_>,
    stream_id: u32,
    resp: &Response,
    bodies: &mut std::collections::VecDeque<Body>,
    peer: &Peer,
) -> Result<()>
where
    S: AsyncWrite + Unpin,
{
    let status = resp.status.to_string();
    let len = resp.body.len().to_string();

    let mut fields: Vec<(&[u8], &[u8])> = vec![(b":status", status.as_bytes())];
    for (k, v) in &resp.headers {
        fields.push((k.as_bytes(), v.as_bytes()));
    }
    fields.push((b"content-length", len.as_bytes()));

    let encoded = encoder.encode(fields);
    frame::write_frame(
        stream,
        frame::HEADERS,
        frame::FLAG_END_HEADERS,
        stream_id,
        &encoded,
    )
    .await?;

    // An empty body still needs an END_STREAM; zero-length DATA is not
    // flow-controlled, so send it now rather than queueing it.
    if resp.body.is_empty() {
        frame::write_frame(stream, frame::DATA, frame::FLAG_END_STREAM, stream_id, &[]).await?;
        stream.flush().await?;
        return Ok(());
    }

    bodies.push_back(Body {
        stream_id,
        data: resp.body.clone(),
        sent: 0,
        window: peer.initial_window,
    });
    stream.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http2::frame::{FLAG_END_HEADERS, FLAG_END_STREAM};
    use std::io::Cursor;
    use tokio::io::duplex;

    /// Drive a full connection: preface, SETTINGS, WINDOW_UPDATE, PRIORITY,
    /// HEADERS — and confirm the resulting fingerprint and response.
    #[tokio::test]
    async fn full_connection_produces_chrome_like_fingerprint() {
        let (client, mut server) = duplex(64 * 1024);
        // Split so we can close only the request direction. Dropping the whole
        // duplex would also kill the server's write side mid-response.
        let (_client_rx, mut client) = tokio::io::split(client);

        let server_task = tokio::spawn(async move {
            let mut captured = None;
            let r = serve(&mut server, |req, obs| {
                captured = Some((akamai::fingerprint(obs), req.path().to_string()));
                Response::text(200, "ok")
            })
            .await;
            (r, captured)
        });

        // Client preface.
        client.write_all(frame::PREFACE).await.unwrap();

        // SETTINGS in Chrome's order.
        let mut sp = Vec::new();
        for (id, val) in [
            (1u16, 65536u32),
            (2, 0),
            (3, 1000),
            (4, 6291456),
            (6, 262144),
        ] {
            sp.extend_from_slice(&id.to_be_bytes());
            sp.extend_from_slice(&val.to_be_bytes());
        }
        frame::write_frame(&mut client, frame::SETTINGS, 0, 0, &sp)
            .await
            .unwrap();

        // Connection-level WINDOW_UPDATE.
        frame::write_frame(
            &mut client,
            frame::WINDOW_UPDATE,
            0,
            0,
            &15663105u32.to_be_bytes(),
        )
        .await
        .unwrap();

        // HEADERS with Chrome's pseudo-header order.
        let mut enc = Encoder::new();
        let block = enc.encode(vec![
            (b":method".as_slice(), b"GET".as_slice()),
            (b":authority".as_slice(), b"kittens.sh".as_slice()),
            (b":scheme".as_slice(), b"https".as_slice()),
            (b":path".as_slice(), b"/api/all".as_slice()),
            (b"user-agent".as_slice(), b"test".as_slice()),
        ]);
        frame::write_frame(
            &mut client,
            frame::HEADERS,
            FLAG_END_HEADERS | FLAG_END_STREAM,
            1,
            &block,
        )
        .await
        .unwrap();
        client.flush().await.unwrap();

        // Close only the request direction so the server's read loop ends.
        client.shutdown().await.unwrap();

        let (result, captured) = server_task.await.unwrap();
        result.expect("connection should complete cleanly");
        let (fp, path) = captured.expect("responder should have run");

        assert_eq!(path, "/api/all");
        assert_eq!(fp, "1:65536;2:0;3:1000;4:6291456;6:262144|15663105|0|m,a,s,p");
    }

    #[tokio::test]
    async fn priority_frames_are_recorded_in_order() {
        let (client, mut server) = duplex(64 * 1024);
        let (_client_rx, mut client) = tokio::io::split(client);

        let server_task = tokio::spawn(async move {
            let mut captured = None;
            let _ = serve(&mut server, |_req, obs| {
                captured = Some(akamai::fingerprint(obs));
                Response::text(200, "ok")
            })
            .await;
            captured
        });

        client.write_all(frame::PREFACE).await.unwrap();
        frame::write_frame(&mut client, frame::SETTINGS, 0, 0, &[])
            .await
            .unwrap();

        // Firefox's placeholder priority tree.
        for (sid, dep, weight) in [(3u32, 0u32, 200u8), (5, 0, 100), (9, 7, 0)] {
            let mut p = Vec::new();
            p.extend_from_slice(&dep.to_be_bytes());
            p.push(weight);
            frame::write_frame(&mut client, frame::PRIORITY, 0, sid, &p)
                .await
                .unwrap();
        }

        let mut enc = Encoder::new();
        let block = enc.encode(vec![
            (b":method".as_slice(), b"GET".as_slice()),
            (b":path".as_slice(), b"/".as_slice()),
            (b":authority".as_slice(), b"k".as_slice()),
            (b":scheme".as_slice(), b"https".as_slice()),
        ]);
        frame::write_frame(&mut client, frame::HEADERS, FLAG_END_HEADERS, 1, &block)
            .await
            .unwrap();
        client.flush().await.unwrap();
        client.shutdown().await.unwrap();

        let fp = server_task.await.unwrap().expect("responder ran");
        assert!(
            fp.contains("|3:0:0:201,5:0:0:101,9:0:7:1|"),
            "unexpected priority section in {fp}"
        );
        // Firefox-ish pseudo order.
        assert!(fp.ends_with("|m,p,a,s"), "unexpected pseudo order in {fp}");
    }

    #[tokio::test]
    async fn continuation_frames_are_reassembled() {
        let (client, mut server) = duplex(64 * 1024);
        let (_client_rx, mut client) = tokio::io::split(client);

        let server_task = tokio::spawn(async move {
            let mut captured = None;
            let _ = serve(&mut server, |req, _obs| {
                captured = Some(req.headers.clone());
                Response::text(200, "ok")
            })
            .await;
            captured
        });

        client.write_all(frame::PREFACE).await.unwrap();
        frame::write_frame(&mut client, frame::SETTINGS, 0, 0, &[])
            .await
            .unwrap();

        let mut enc = Encoder::new();
        let block = enc.encode(vec![
            (b":method".as_slice(), b"GET".as_slice()),
            (b":authority".as_slice(), b"kittens.sh".as_slice()),
            (b":scheme".as_slice(), b"https".as_slice()),
            (b":path".as_slice(), b"/split".as_slice()),
        ]);
        // Split the block across HEADERS + CONTINUATION.
        let mid = block.len() / 2;
        frame::write_frame(&mut client, frame::HEADERS, 0, 1, &block[..mid])
            .await
            .unwrap();
        frame::write_frame(
            &mut client,
            frame::CONTINUATION,
            FLAG_END_HEADERS,
            1,
            &block[mid..],
        )
        .await
        .unwrap();
        client.flush().await.unwrap();
        client.shutdown().await.unwrap();

        let headers = server_task.await.unwrap().expect("responder ran");
        let path = headers
            .iter()
            .find(|(k, _)| k == ":path")
            .map(|(_, v)| v.clone());
        assert_eq!(path.as_deref(), Some("/split"));
    }

    #[tokio::test]
    async fn bad_preface_is_rejected() {
        let (mut client, mut server) = duplex(1024);
        client.write_all(b"NOT A VALID H2 PREFACE!!!").await.unwrap();
        client.flush().await.unwrap();

        let err = serve(&mut server, |_, _| Response::text(200, "ok"))
            .await
            .expect_err("must reject");
        assert!(err.to_string().contains("bad HTTP/2 preface"));
    }

    /// Regression: a 54 KB JS chunk was sent as one unmetered DATA frame,
    /// blowing past both SETTINGS_MAX_FRAME_SIZE and the 65 KB connection
    /// window. Chrome killed the connection, so no asset ever loaded. curl
    /// missed it by falling back to HTTP/1.1.
    #[tokio::test]
    async fn large_body_is_chunked_and_flow_controlled() {
        let (client, mut server) = duplex(1024 * 1024);
        let (mut client_rx, mut client_tx) = tokio::io::split(client);

        // 100 KB — larger than one frame (16 KB) and than the window (65535).
        let payload: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
        let expected = payload.clone();

        let server_task = tokio::spawn(async move {
            serve(&mut server, move |_req, _obs| {
                Response {
                    status: 200,
                    headers: vec![("content-type".into(), "text/javascript".into())],
                    body: payload.clone(),
                }
            })
            .await
        });

        client_tx.write_all(frame::PREFACE).await.unwrap();
        frame::write_frame(&mut client_tx, frame::SETTINGS, 0, 0, &[])
            .await
            .unwrap();

        let mut enc = Encoder::new();
        let block = enc.encode(vec![
            (b":method".as_slice(), b"GET".as_slice()),
            (b":authority".as_slice(), b"kittens.sh".as_slice()),
            (b":scheme".as_slice(), b"https".as_slice()),
            (b":path".as_slice(), b"/big.js".as_slice()),
        ]);
        frame::write_frame(&mut client_tx, frame::HEADERS, FLAG_END_HEADERS, 1, &block)
            .await
            .unwrap();
        client_tx.flush().await.unwrap();

        // Read frames, granting window credit as a real client would.
        let mut got = Vec::new();
        let mut data_frames = 0;
        let mut saw_end_stream = false;
        let mut consumed_since_update = 0usize;

        while !saw_end_stream {
            let (h, p) = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                frame::read_frame(&mut client_rx),
            )
            .await
            .expect("server stalled — flow control deadlock")
            .expect("frame read failed");

            match h.typ {
                frame::DATA => {
                    assert!(
                        p.len() <= DEFAULT_MAX_FRAME,
                        "DATA frame of {} exceeds max frame size",
                        p.len()
                    );
                    data_frames += 1;
                    consumed_since_update += p.len();
                    got.extend_from_slice(&p);
                    if h.has(FLAG_END_STREAM) {
                        saw_end_stream = true;
                    }
                    // Replenish both windows, as a browser does on consumption.
                    if consumed_since_update > 16_000 && !saw_end_stream {
                        let inc = (consumed_since_update as u32).to_be_bytes();
                        frame::write_frame(&mut client_tx, frame::WINDOW_UPDATE, 0, 0, &inc)
                            .await
                            .unwrap();
                        frame::write_frame(&mut client_tx, frame::WINDOW_UPDATE, 0, 1, &inc)
                            .await
                            .unwrap();
                        client_tx.flush().await.unwrap();
                        consumed_since_update = 0;
                    }
                }
                _ => {}
            }
        }

        assert_eq!(got.len(), expected.len(), "truncated body");
        assert_eq!(got, expected, "body corrupted while chunking");
        assert!(
            data_frames >= 7,
            "100 KB must span multiple frames, got {data_frames}"
        );

        client_tx.shutdown().await.unwrap();
        let _ = server_task.await.unwrap();
    }

    /// Without credit, the server must stop at the initial window rather than
    /// overrunning it.
    #[tokio::test]
    async fn respects_initial_window_without_credit() {
        let (client, mut server) = duplex(1024 * 1024);
        let (mut client_rx, mut client_tx) = tokio::io::split(client);

        let payload = vec![b'x'; 200_000];
        tokio::spawn(async move {
            let _ = serve(&mut server, move |_req, _obs| Response {
                status: 200,
                headers: vec![],
                body: payload.clone(),
            })
            .await;
        });

        client_tx.write_all(frame::PREFACE).await.unwrap();
        frame::write_frame(&mut client_tx, frame::SETTINGS, 0, 0, &[])
            .await
            .unwrap();
        let mut enc = Encoder::new();
        let block = enc.encode(vec![
            (b":method".as_slice(), b"GET".as_slice()),
            (b":path".as_slice(), b"/big".as_slice()),
            (b":scheme".as_slice(), b"https".as_slice()),
            (b":authority".as_slice(), b"k".as_slice()),
        ]);
        frame::write_frame(&mut client_tx, frame::HEADERS, FLAG_END_HEADERS, 1, &block)
            .await
            .unwrap();
        client_tx.flush().await.unwrap();

        // Drain until the server goes quiet, granting no window credit.
        let mut total = 0usize;
        loop {
            match tokio::time::timeout(
                std::time::Duration::from_millis(400),
                frame::read_frame(&mut client_rx),
            )
            .await
            {
                Ok(Ok((h, p))) if h.typ == frame::DATA => total += p.len(),
                Ok(Ok(_)) => {}
                // Timeout is the expected outcome: blocked awaiting credit.
                _ => break,
            }
        }

        assert_eq!(
            total, DEFAULT_WINDOW as usize,
            "server must send exactly the initial window and then wait"
        );
    }

    #[tokio::test]
    async fn response_is_parseable_headers_then_data() {
        let mut out = Vec::new();
        let mut enc = Encoder::new();
        let resp = Response::json(200, b"{\"a\":1}".to_vec());
        let mut bodies = std::collections::VecDeque::new();
        let mut peer = Peer::default();
        write_response(&mut out, &mut enc, 1, &resp, &mut bodies, &peer)
            .await
            .unwrap();
        // The body is queued rather than written inline, so drain it.
        flush_bodies(&mut out, &mut bodies, &mut peer).await.unwrap();

        let mut cur = Cursor::new(out);
        let (h1, block) = frame::read_frame(&mut cur).await.unwrap();
        assert_eq!(h1.typ, frame::HEADERS);
        assert!(h1.has(FLAG_END_HEADERS));

        let mut dec = Decoder::new();
        let fields = dec.decode(&block).unwrap();
        let status = fields
            .iter()
            .find(|(k, _)| k == b":status")
            .map(|(_, v)| v.clone());
        assert_eq!(status.as_deref(), Some(b"200".as_slice()));

        let (h2, body) = frame::read_frame(&mut cur).await.unwrap();
        assert_eq!(h2.typ, frame::DATA);
        assert!(h2.has(FLAG_END_STREAM));
        assert_eq!(body, b"{\"a\":1}");
    }
}
