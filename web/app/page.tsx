"use client";

/**
 * The measurement must happen in the visitor's own browser.
 *
 * This fetch is client-side on purpose. Anything server-rendered would
 * fingerprint the machine that built the page, not the visitor, and the site
 * would be silently, confidently wrong.
 *
 * In production it is same-origin: the Rust server serves both this page and
 * /api/all, so the fetch reuses the connection that loaded the page. Setting
 * NEXT_PUBLIC_ORIGIN_URL points it at a separate host, which is only used for
 * local development against `next dev`.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
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
    <div className="min-h-screen">
      <Masthead />

      <main className="mx-auto w-full max-w-[1240px] px-6 lg:px-8">
        {state.status === "loading" && (
          <p className="py-24 font-mono text-sm text-muted-foreground">
            Reading your handshake.
          </p>
        )}

        {state.status === "error" && <ErrorState message={state.message} />}
        {state.status === "ready" && <Report fp={state.data} />}
      </main>

      <Footer />
    </div>
  );
}

function Masthead() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-[1240px] items-center justify-between px-6 py-5 lg:px-8">
        <a href="/" className="font-display text-lg font-extrabold tracking-tight">
          kittens<span className="text-canopy">.sh</span>
        </a>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          <a href="/docs" className="transition-colors hover:text-ink">
            Docs
          </a>
          <a href={`${ORIGIN}/api/all`} className="transition-colors hover:text-ink">
            API
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-8 border-t border-line">
      <div className="mx-auto flex w-full max-w-[1240px] flex-wrap justify-between gap-3 px-6 py-8 text-sm text-muted-foreground lg:px-8">
        <span>Measured from your connection. Nothing is stored.</span>
        <span className="font-mono text-[11px]">JA3 · JA4 · Akamai HTTP/2</span>
      </div>
    </footer>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="py-20">
      <h1 className="h2 mb-3">We couldn&rsquo;t read your handshake.</h1>
      <p className="lede mb-2">
        The fingerprint origin didn&rsquo;t answer: {message}.
      </p>
      <p className="lede">
        It terminates TLS itself, so it has to be reached directly. A proxy in
        front of it would measure the proxy.
      </p>
    </div>
  );
}

function Report({ fp }: { fp: Fingerprint }) {
  const verdict = classify(fp);
  const [a, b, c] = fp.ja4.split("_");
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(fp.ja4).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {},
    );
  };

  return (
    <>
      {/* Hero: the fingerprint itself, in mono because that is what it is. */}
      <section className="py-14 lg:py-20">
        <p className="label mb-4">Your JA4 fingerprint</p>

        <h1 className="no-scrollbar mb-6 overflow-x-auto whitespace-nowrap font-mono text-[clamp(1rem,4.4vw,2.6rem)] font-medium tracking-tight">
          <span className="text-ink">{a}</span>
          <span className="text-muted-foreground">_</span>
          <span className="text-canopy">{b}</span>
          <span className="text-muted-foreground">_</span>
          <span className="text-canopy">{c}</span>
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Button onClick={copy}>{copied ? "Copied" : "Copy fingerprint"}</Button>
          <p className="text-base">
            Looks like <strong className="font-semibold">{verdict.family}</strong>
            {verdict.confidence > 0 && (
              <span className="ml-2 rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                {verdict.confidence}% match
              </span>
            )}
            <span className="ml-2 text-muted-foreground">
              claims {describeClient(fp)}
            </span>
          </p>
        </div>

        {/* Terracotta is the brand's single focal point, used sparingly. A
            handshake that contradicts its own User-Agent earns it. */}
        {verdict.mismatch && (
          <div className="mt-6 rounded-2xl border border-terracotta/40 border-l-[3px] border-l-terracotta bg-terracotta/[0.06] px-4 py-3">
            <p className="text-sm">
              <strong className="font-semibold text-terracotta">
                Handshake and User-Agent disagree.
              </strong>{" "}
              The User-Agent claims {verdict.uaFamily}, but the TLS handshake
              looks like {verdict.family}. That&rsquo;s what an impersonation
              library looks like before it matches its target.
            </p>
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
        note="SNI and ALPN counted, not hashed"
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

      <div className="grid grid-cols-1 gap-5 pb-4 md:grid-cols-2 lg:grid-cols-3">
        <section className="panel">
          <h2 className="label mb-4">Fingerprints</h2>
          <dl className="space-y-0">
            <Row label="JA4" value={fp.ja4} mono />
            <Row label="JA3" value={fp.ja3_hash} mono />
            {fp.http2 && (
              <Row label="Akamai" value={fp.http2.akamai_fingerprint} mono />
            )}
          </dl>
          <p className="label mb-2 mt-5">JA4 before hashing</p>
          <p className="break-all rounded-lg border border-line bg-muted/50 px-3 py-2 font-mono text-[11px] leading-relaxed">
            {fp.ja4_r}
          </p>
        </section>

        <section className="panel">
          <h2 className="label mb-4">Why we think that</h2>
          {verdict.signals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing distinctive in this handshake. That&rsquo;s unusual. Most
              stacks leak something.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {verdict.signals.map((s, i) => (
                <li key={i} className="flex items-baseline gap-2.5 text-sm">
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {s.implies}
                  </span>
                  <span className="text-muted-foreground">{s.observed}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2 className="label mb-4">TLS</h2>
          <dl>
            <Row label="Negotiated" value={fp.tls.negotiated_version} mono />
            <Row label="Offered (max)" value={fp.tls.effective_version} mono />
            <Row label="Legacy field" value={fp.tls.legacy_version} mono />
            <Row label="Cipher" value={fp.tls.negotiated_cipher} mono />
            <Row label="SNI" value={fp.tls.sni ?? "not sent"} mono />
            <Row
              label="Session ID"
              value={`${fp.tls.session_id_length} bytes`}
              mono
            />
          </dl>
          <p className="label mb-2 mt-5">ALPN offered</p>
          <div className="flex flex-wrap gap-1.5">
            {fp.tls.alpn.length === 0 && (
              <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                none
              </span>
            )}
            {fp.tls.alpn.map((p) => (
              <span
                key={p}
                className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] ${
                  p === fp.tls.negotiated_alpn
                    ? "bg-canopy text-snow"
                    : "border border-line text-muted-foreground"
                }`}
              >
                {p}
              </span>
            ))}
          </div>
        </section>

        {fp.http2 && (
          <section className="panel">
            <h2 className="label mb-4">HTTP/2</h2>
            <dl>
              <Row
                label="Pseudo-header order"
                value={fp.http2.pseudo_header_order.join(", ")}
                mono
              />
              <Row
                label="Window update"
                value={
                  fp.http2.window_update === null
                    ? "none"
                    : fp.http2.window_update.toLocaleString()
                }
                mono
              />
              <Row
                label="PRIORITY frames"
                value={String(fp.http2.priorities.length)}
                mono
              />
            </dl>
            <p className="label mb-2 mt-5">SETTINGS, in the order sent</p>
            <dl>
              {fp.http2.settings.map((s) => (
                <Row
                  key={s.id}
                  label={s.name.toLowerCase().replace(/_/g, " ")}
                  value={s.value.toLocaleString()}
                  mono
                />
              ))}
            </dl>
          </section>
        )}

        {fp.http1 && (
          <section className="panel">
            <h2 className="label mb-4">HTTP/1.1 header order</h2>
            <dl>
              {fp.http1.headers.map(([k, v], i) => (
                <Row
                  key={`${k}-${i}`}
                  label={k}
                  value={v.length > 48 ? `${v.slice(0, 48)}…` : v}
                  mono
                />
              ))}
            </dl>
          </section>
        )}

        <section className="panel">
          <h2 className="label mb-4">Connection</h2>
          <dl>
            <Row label="IP" value={fp.ip} mono />
            <Row label="Protocol" value={fp.protocol} mono />
            <Row label="User-Agent" value={fp.user_agent ?? "not sent"} mono />
          </dl>
        </section>
      </div>

      <details className="panel group mb-10 p-0">
        <summary className="cursor-pointer list-none px-5 py-4 font-mono text-xs text-muted-foreground transition-colors hover:text-ink">
          <span className="group-open:hidden">▸</span>
          <span className="hidden group-open:inline">▾</span> Raw JSON
        </summary>
        <pre className="no-scrollbar overflow-x-auto px-5 pb-5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {JSON.stringify(fp, null, 2)}
        </pre>
      </details>
    </>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  if (value === null) return null;
  return (
    <div className="grid grid-cols-[minmax(96px,38%)_1fr] items-baseline gap-3 border-b border-line/60 py-1.5 last:border-b-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      {/* break-all, not break-words: fingerprints and cipher names are single
          unbroken tokens, so overflow-wrap has nothing to break on and they
          run past the card edge. */}
      <dd className={`text-[13px] ${mono ? "break-all font-mono" : "break-words"}`}>
        {value}
      </dd>
    </div>
  );
}
