"use client";

/**
 * The measurement must happen in the visitor's own browser.
 *
 * This fetch is client-side on purpose. Anything server-rendered would
 * fingerprint the datacentre the page was built in, not the visitor — the site
 * would be silently, confidently wrong.
 *
 * In production this is same-origin: the Rust server serves both this page and
 * /api/all, so the fetch reuses the connection that loaded the page. Setting
 * NEXT_PUBLIC_ORIGIN_URL points it at a separate host, which is only used for
 * local development against `next dev`.
 */

import { useEffect, useState } from "react";
import { Tape } from "@/components/Tape";
import { classify, describeClient } from "@/lib/classify";
import type { Fingerprint } from "@/lib/types";

const ORIGIN = process.env.NEXT_PUBLIC_ORIGIN_URL ?? "";

type State =
  | { status: "loading" }
  | { status: "ready"; data: Fingerprint }
  | { status: "error"; message: string };

export default function Home() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${ORIGIN}/api/all`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`origin returned ${r.status}`);
        return (await r.json()) as Fingerprint;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <header className="wrap">
        <div className="masthead">
          <span className="wordmark">
            kittens<span>.sh</span>
          </span>
          <nav>
            <a href="/docs">docs</a>
            <a href={`${ORIGIN}/api/all`}>api</a>
            <a href="https://github.com/kittens-sh">source</a>
          </nav>
        </div>
      </header>

      <main className="wrap">
        {state.status === "loading" && (
          <p className="state">Reading your handshake…</p>
        )}

        {state.status === "error" && (
          <div className="state error">
            <p>Could not reach the fingerprint origin at <code>{ORIGIN}</code>.</p>
            <p style={{ color: "var(--text-dim)" }}>
              {state.message}. The origin terminates TLS itself, so it has to be
              reached directly — a proxy in front of it would measure the proxy.
            </p>
          </div>
        )}

        {state.status === "ready" && <Report fp={state.data} />}
      </main>

      <div className="wrap">
        <footer className="site">
          <span>Measured from your connection. Nothing is stored.</span>
          <span>JA3 · JA4 · Akamai HTTP/2</span>
        </footer>
      </div>
    </>
  );
}

function Report({ fp }: { fp: Fingerprint }) {
  const verdict = classify(fp);
  const [a, b, c] = fp.ja4.split("_");

  return (
    <>
      <section className="readout">
        <p className="eyebrow acquire">Your JA4 fingerprint</p>
        <h1 className="fingerprint acquire acquire-2">
          {a}
          <span className="sep">_</span>
          <span className="hashed">{b}</span>
          <span className="sep">_</span>
          <span className="hashed">{c}</span>
        </h1>

        <div className="verdict acquire acquire-3">
          <span>
            Looks like <strong>{verdict.family}</strong>
          </span>
          {verdict.confidence > 0 && (
            <span className="confidence">{verdict.confidence}% match</span>
          )}
          <span style={{ color: "var(--text-faint)" }}>
            claims {describeClient(fp)}
          </span>
        </div>

        {verdict.mismatch && (
          <div className="mismatch acquire acquire-3">
            <b>Handshake and User-Agent disagree.</b> The User-Agent claims{" "}
            {verdict.uaFamily}, but the TLS handshake looks like{" "}
            {verdict.family}. That is what an impersonation library looks like
            when it hasn&rsquo;t matched the target stack yet.
          </div>
        )}
      </section>

      <Tape
        title="Cipher suites, in the order offered"
        cells={fp.tls.cipher_suites.map((x) => ({
          hex: x.hex,
          name: x.name,
          grease: x.grease,
        }))}
      />

      <Tape
        title="Extensions, in the order sent"
        cells={fp.tls.extensions.map((x) => ({
          hex: x.hex,
          name: x.name,
          grease: x.grease,
        }))}
        note="SNI and ALPN counted but not hashed"
      />

      {fp.tls.supported_groups.length > 0 && (
        <Tape
          title="Key exchange groups"
          cells={fp.tls.supported_groups.map((x) => ({
            hex: x.hex,
            name: x.name,
            grease: x.grease,
          }))}
        />
      )}

      <div className="grid">
        <section className="panel">
          <h2>Fingerprints</h2>
          <dl className="rows">
            <div className="row">
              <dt>JA4</dt>
              <dd>{fp.ja4}</dd>
            </div>
            <div className="row">
              <dt>JA3</dt>
              <dd>{fp.ja3_hash}</dd>
            </div>
            {fp.http2 && (
              <div className="row">
                <dt>Akamai</dt>
                <dd>{fp.http2.akamai_fingerprint}</dd>
              </div>
            )}
          </dl>
          <p className="eyebrow" style={{ margin: "1rem 0 0.35rem" }}>
            JA4 before hashing
          </p>
          <div className="hashline">{fp.ja4_r}</div>
        </section>

        <section className="panel">
          <h2>Why we think that</h2>
          {verdict.signals.length === 0 ? (
            <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", margin: 0 }}>
              Nothing distinctive in this handshake. That is itself unusual —
              most stacks leak something.
            </p>
          ) : (
            <ul className="evidence">
              {verdict.signals.map((s, i) => (
                <li key={i}>
                  <span className="implies">{s.implies}</span>
                  <span>{s.observed}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>TLS</h2>
          <dl className="rows">
            <Row label="Negotiated" value={fp.tls.negotiated_version} />
            <Row label="Offered (max)" value={fp.tls.effective_version} />
            <Row label="Legacy field" value={fp.tls.legacy_version} />
            <Row label="Cipher" value={fp.tls.negotiated_cipher} />
            <Row label="SNI" value={fp.tls.sni ?? "not sent"} />
            <Row
              label="Session ID"
              value={`${fp.tls.session_id_length} bytes`}
              num
            />
            {fp.tls.record_size_limit !== null && (
              <Row
                label="Record size limit"
                value={String(fp.tls.record_size_limit)}
                num
              />
            )}
          </dl>
          <p className="eyebrow" style={{ margin: "1rem 0 0.35rem" }}>
            ALPN offered
          </p>
          <div className="chips">
            {fp.tls.alpn.length === 0 && <span className="chip">none</span>}
            {fp.tls.alpn.map((p) => (
              <span
                key={p}
                className={p === fp.tls.negotiated_alpn ? "chip on" : "chip"}
              >
                {p}
              </span>
            ))}
          </div>
        </section>

        {fp.http2 && (
          <section className="panel">
            <h2>HTTP/2</h2>
            <dl className="rows">
              <Row
                label="Pseudo-header order"
                value={fp.http2.pseudo_header_order.join(", ")}
              />
              <Row
                label="Window update"
                value={
                  fp.http2.window_update === null
                    ? "none"
                    : fp.http2.window_update.toLocaleString()
                }
                num
              />
              <Row
                label="PRIORITY frames"
                value={String(fp.http2.priorities.length)}
                num
              />
            </dl>
            <p className="eyebrow" style={{ margin: "1rem 0 0.35rem" }}>
              SETTINGS, in the order sent
            </p>
            <dl className="rows">
              {fp.http2.settings.map((s) => (
                <div className="row" key={s.id}>
                  <dt>{s.name.toLowerCase().replace(/_/g, " ")}</dt>
                  <dd className="num">{s.value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {fp.http1 && (
          <section className="panel">
            <h2>HTTP/1.1 header order</h2>
            <dl className="rows">
              {fp.http1.headers.map(([k, v], i) => (
                <div className="row" key={`${k}-${i}`}>
                  <dt>{k}</dt>
                  <dd>{v.length > 60 ? `${v.slice(0, 60)}…` : v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section className="panel">
          <h2>Connection</h2>
          <dl className="rows">
            <Row label="IP" value={fp.ip} />
            <Row label="Protocol" value={fp.protocol} />
            <Row label="User-Agent" value={fp.user_agent ?? "not sent"} />
          </dl>
        </section>
      </div>

      <details className="raw">
        <summary>Raw JSON</summary>
        <pre>{JSON.stringify(fp, null, 2)}</pre>
      </details>
    </>
  );
}

function Row({
  label,
  value,
  num,
}: {
  label: string;
  value: string | null;
  num?: boolean;
}) {
  if (value === null) return null;
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd className={num ? "num" : undefined}>{value}</dd>
    </div>
  );
}
