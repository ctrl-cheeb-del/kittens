"use client";

/**
 * The default report, plus two raw lenses on the same data.
 *
 * Earlier there were ten layout variants; most were the same box grid wearing
 * different clothes. What survives is one view people should actually read and
 * two that show the data at a level the default deliberately summarises.
 */

import type { Classification } from "@/lib/classify";
import type { Section } from "@/lib/sections";
import type { Fingerprint } from "@/lib/types";
import { ExtraBlock, FieldRow } from "./shared";

/* ---------------------------------------------------------------- default */

/**
 * Overview — counts up top, then full-width bands.
 *
 * No giant fingerprint: the hash is the least readable thing on the page and
 * it already sits in the Fingerprints band, copyable. What a person can take
 * in at a glance is how *much* their client disclosed, so the counts lead.
 *
 * Section cards run full width and stack. There are always five sections,
 * five never divides evenly into three columns, and every multi-column
 * attempt ended on a ragged row.
 */
export function Overview({
  fp,
  verdict,
  sections,
}: {
  fp: Fingerprint;
  verdict: Classification;
  sections: Section[];
}) {
  const live = (xs: { grease: boolean }[]) => xs.filter((x) => !x.grease).length;

  const stats = [
    { n: live(fp.tls.cipher_suites), l: "cipher suites" },
    { n: live(fp.tls.extensions), l: "extensions" },
    { n: live(fp.tls.supported_groups), l: "key exchange groups" },
    { n: live(fp.tls.signature_algorithms), l: "signature algorithms" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.l} className="rounded-2xl border border-line bg-card p-5">
            <div className="font-display text-[clamp(1.9rem,4vw,2.75rem)] font-extrabold leading-none tracking-tighter">
              {s.n}
            </div>
            <div className="label mt-2">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Cards, but full width and stacked. Five sections never divide evenly
          into three columns, so anything multi-column ends on a ragged row;
          going full width keeps the card surface without that problem. */}
      <div className="mt-6 space-y-4">
        {sections.map((s) => (
          <section
            key={s.id}
            className="grid gap-x-10 gap-y-4 rounded-2xl border border-line bg-card p-5 sm:p-6 lg:grid-cols-[220px_1fr]"
          >
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight">
                {s.title}
              </h2>
              <p className="label mt-1">
                {s.fields.length} {s.fields.length === 1 ? "field" : "fields"}
              </p>
            </div>

            <div className="min-w-0">
              {s.id === "signals" ? (
                <ul>
                  {s.fields.map((f, i) => (
                    <FieldRow key={i} f={f} showStrength />
                  ))}
                </ul>
              ) : (
                <dl className="grid gap-x-12 sm:grid-cols-2">
                  {s.fields.map((f, i) => (
                    <FieldRow key={i} f={f} />
                  ))}
                </dl>
              )}
              {s.extra && <ExtraBlock extra={s.extra} />}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        {verdict.family === "Unknown"
          ? "Nothing in this handshake is distinctive enough to place."
          : `Every value above fed the verdict of ${verdict.family}.`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ raw lenses */

/**
 * Periodic — every value the client offered, at once.
 *
 * The default summarises the lists ("16 extensions"). This refuses to, and
 * shows all of them colour-coded by kind. The point it makes is volume: how
 * many small choices a client discloses before sending a byte of request.
 */
export function Periodic({ fp }: { fp: Fingerprint }) {
  const groups = [
    { key: "cipher", label: "Cipher suites", items: fp.tls.cipher_suites },
    { key: "ext", label: "Extensions", items: fp.tls.extensions },
    {
      key: "group",
      label: "Key exchange groups",
      items: fp.tls.supported_groups,
    },
    {
      key: "sig",
      label: "Signature algorithms",
      items: fp.tls.signature_algorithms,
    },
  ];

  const tone: Record<string, string> = {
    cipher: "border-canopy/30 bg-canopy/[0.07]",
    ext: "border-graphite/25 bg-graphite/[0.05]",
    group: "border-sprout/40 bg-sprout/[0.09]",
    sig: "border-line bg-muted/50",
  };

  return (
    <div className="space-y-6">
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.key}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="label">{g.label}</h2>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {g.items.filter((i) => !i.grease).length} hashed
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
                {g.items.map((it, i) => (
                  <button
                    key={`${it.hex}-${i}`}
                    type="button"
                    title={`${it.hex} ${it.name}. Click to copy.`}
                    onClick={() => navigator.clipboard?.writeText(it.hex)}
                    className={`rounded-lg border p-2 text-left transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${
                      it.grease
                        ? "border-dashed border-line bg-transparent opacity-60"
                        : tone[g.key]
                    }`}
                  >
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div
                      className={`font-mono text-[13px] ${
                        it.grease
                          ? "text-muted-foreground line-through"
                          : "text-ink"
                      }`}
                    >
                      {it.hex}
                    </div>
                    <div className="truncate text-[10px] leading-tight text-muted-foreground">
                      {it.grease ? "GREASE" : it.name}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ),
      )}
    </div>
  );
}

/**
 * Hexdump — the actual ClientHello bytes, annotated.
 *
 * The ground truth everything else is derived from: the exact bytes the client
 * put on the wire, before anything interpreted them. The server records
 * labelled byte ranges while parsing, so each region can be tinted and named
 * without the browser reimplementing the parser.
 */
export function Hexdump({ fp }: { fp: Fingerprint }) {
  const raw = fp.tls.raw;
  if (!raw?.hex) {
    return (
      <p className="rounded-2xl border border-line bg-card p-5 text-sm text-muted-foreground">
        This origin didn&rsquo;t return the raw handshake.
      </p>
    );
  }

  const bytes: number[] = [];
  for (let i = 0; i < raw.hex.length; i += 2) {
    bytes.push(parseInt(raw.hex.slice(i, i + 2), 16));
  }

  const labelAt = (i: number) =>
    raw.spans.find((s) => i >= s.start && i < s.end);

  const tintOf = (label: string | undefined) => {
    if (!label) return "";
    if (label.startsWith("ext ")) {
      // Alternate so neighbouring extensions stay distinguishable.
      const idx = raw.spans.findIndex((s) => s.label === label);
      return idx % 2 ? "bg-sprout/15" : "bg-sprout/30";
    }
    if (label.includes("cipher")) return "bg-canopy/20";
    if (label.includes("random")) return "bg-graphite/10";
    if (label.includes("session")) return "bg-terracotta/15";
    return "bg-muted";
  };

  const rows: number[][] = [];
  for (let i = 0; i < bytes.length; i += 16) rows.push(bytes.slice(i, i + 16));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="label">ClientHello, as it arrived</h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          {raw.length} bytes · {raw.spans.length} labelled regions
        </span>
      </div>

      <div className="no-scrollbar overflow-x-auto rounded-2xl border border-line bg-card p-4 sm:p-5">
        <table className="font-mono text-[12px] leading-[1.55]">
          <tbody>
            {rows.map((row, r) => {
              const base = r * 16;
              const region = labelAt(base);
              return (
                <tr key={r} className="group/row">
                  <td className="select-none pr-4 align-top text-muted-foreground">
                    {base.toString(16).padStart(4, "0")}
                  </td>
                  <td className="whitespace-nowrap pr-4 align-top">
                    {row.map((b, i) => {
                      const sp = labelAt(base + i);
                      return (
                        <span
                          key={i}
                          title={sp?.label ?? "padding"}
                          className={`${tintOf(sp?.label)} ${
                            i === 7 ? "pr-2" : ""
                          } rounded-[2px] px-[1px]`}
                        >
                          {b.toString(16).padStart(2, "0")}{" "}
                        </span>
                      );
                    })}
                  </td>
                  <td className="whitespace-pre pr-4 align-top text-muted-foreground">
                    {row
                      .map((b) =>
                        b >= 32 && b < 127 ? String.fromCharCode(b) : "·",
                      )
                      .join("")}
                  </td>
                  <td className="whitespace-nowrap align-top text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100">
                    {region?.label ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        {raw.spans.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5 text-[11px]">
            <span
              className={`inline-block h-3 w-3 rounded-[2px] border border-line ${tintOf(s.label)}`}
            />
            <span className="font-mono text-muted-foreground">{s.label}</span>
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {s.end - s.start}B
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
