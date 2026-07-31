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
import { Cat } from "@/components/Cat";
import {
  Report as ReportBody,
  ViewPicker,
  useView,
} from "@/components/layouts";
import { Tape } from "@/components/Tape";
import {
  classify,
  headline,
  moodFor,
  subline,
  volunteered,
} from "@/lib/classify";
import { buildSections } from "@/lib/sections";
import type { Fingerprint } from "@/lib/types";

const ORIGIN = process.env.NEXT_PUBLIC_ORIGIN_URL ?? "";

type State =
  | { status: "loading" }
  | { status: "ready"; data: Fingerprint }
  | { status: "error"; message: string };

export function Inspector() {
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
      {state.status === "loading" && (
        <p className="py-24 font-mono text-sm text-muted-foreground">
          Reading your handshake.
        </p>
      )}

      {state.status === "error" && <ErrorState message={state.message} />}
      {state.status === "ready" && <Report fp={state.data} />}
    </>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="py-20">
      <h2 className="h2 mb-3">We couldn&rsquo;t read your handshake.</h2>
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
  const mood = moodFor(verdict);
  const sub = subline(fp, verdict);
  const leaked = volunteered(fp);
  const sections = buildSections(fp, verdict);
  const [view, setView] = useView();
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

        <div className="no-scrollbar mb-8 overflow-x-auto">
          <p className="whitespace-nowrap font-mono text-[clamp(1.05rem,4.6vw,2.75rem)] font-medium tracking-tight">
            <span className="text-ink">{a}</span>
            <span className="text-muted-foreground">_</span>
            <span className="text-canopy">{b}</span>
            <span className="text-muted-foreground">_</span>
            <span className="text-canopy">{c}</span>
          </p>
        </div>


        {/* The verdict, led by the cat. Terracotta is the brand's single focal
            point, so it is spent only on the disagreement case. */}
        <div
          className={`flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center ${
            verdict.mismatch
              ? "border-terracotta/40 bg-terracotta/[0.05]"
              : "border-line bg-card"
          }`}
        >
          <Cat
            mood={mood}
            className={`shrink-0 ${
              verdict.mismatch
                ? "text-terracotta"
                : mood === "curious"
                  ? "text-muted-foreground"
                  : "text-canopy"
            }`}
          />

          <div className="min-w-0 flex-1">
            <p className="font-display text-xl font-bold leading-snug tracking-tight">
              {headline(verdict)}
              {verdict.confidence > 0 && (
                <span className="ml-2 align-middle font-mono text-[11px] font-normal text-muted-foreground">
                  {verdict.confidence}%
                </span>
              )}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {sub}
              {sub && " · "}
              <span className="font-mono text-[12px]">{leaked}</span> values
              volunteered
            </p>

          </div>

          <div className="shrink-0">
            <Button onClick={copy}>
              <span className="inline-grid">
                <span aria-hidden className="invisible col-start-1 row-start-1">
                  Copy JA4
                </span>
                <span className="col-start-1 row-start-1">
                  {copied ? "Copied" : "Copy JA4"}
                </span>
              </span>
            </Button>
          </div>
        </div>
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

      <div className="mb-5 flex flex-wrap items-center gap-3 pt-2">
        <ViewPicker value={view} onChange={setView} />
      </div>

      <div className="pb-4">
        <ReportBody
          view={view}
          fp={fp}
          verdict={verdict}
          sections={sections}
        />
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
