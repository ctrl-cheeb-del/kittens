/**
 * The report as data rather than markup.
 *
 * Every layout variant renders this same array, so switching layouts can't
 * quietly change what the page reports. Anything a layout needs to make its
 * own decisions (how long a value is, how strong a signal is) lives here as a
 * field rather than being baked into JSX.
 */

import type { Classification } from "./classify";
import type { Fingerprint } from "./types";

export interface Field {
  label: string;
  value: string;
  mono?: boolean;
  /** Offer click-to-copy. Reserved for things meant to be pasted elsewhere. */
  copy?: boolean;
  /** Signals only: 1-4, how much this tell is worth. */
  strength?: number;
  /** Signals only: this tell agrees with the verdict. */
  agrees?: boolean;
}

export type Extra =
  | { kind: "chips"; label: string; items: string[]; active?: string | null }
  | { kind: "code"; label: string; text: string };

export interface Section {
  id: string;
  title: string;
  fields: Field[];
  extra?: Extra;
  /** Rough footprint, used by the layouts that vary cell size. */
  weight: "lg" | "md" | "sm";
}

export function buildSections(
  fp: Fingerprint,
  verdict: Classification,
): Section[] {
  const sections: Section[] = [];

  sections.push({
    id: "signals",
    title: "Signals",
    weight: "lg",
    fields:
      verdict.signals.length === 0
        ? [
            {
              label: "none",
              value:
                "Nothing here is distinctive enough to place. That is unusual on its own.",
            },
          ]
        : verdict.signals.map((s) => ({
            label: s.implies,
            value: s.observed,
            strength: s.weight,
            agrees: s.implies === verdict.family,
          })),
  });

  sections.push({
    id: "fingerprints",
    title: "Fingerprints",
    weight: "lg",
    fields: [
      // JA4 itself lives in the hero, beside the copy button.
      { label: "JA3", value: fp.ja3_hash, mono: true, copy: true },
      ...(fp.http2
        ? [
            {
              label: "Akamai",
              value: fp.http2.akamai_fingerprint,
              mono: true,
              copy: true,
            },
          ]
        : []),
    ],
    extra: { kind: "code", label: "JA4, before hashing", text: fp.ja4_r },
  });

  sections.push({
    id: "tls",
    title: "TLS",
    weight: "md",
    fields: [
      { label: "Negotiated", value: fp.tls.negotiated_version ?? "—", mono: true },
      { label: "Offered (max)", value: fp.tls.effective_version, mono: true },
      { label: "Legacy field", value: fp.tls.legacy_version, mono: true },
      { label: "Cipher", value: fp.tls.negotiated_cipher ?? "—", mono: true },
      { label: "SNI", value: fp.tls.sni ?? "not sent", mono: true },
      {
        label: "Session ID",
        value: `${fp.tls.session_id_length} bytes`,
        mono: true,
      },
    ],
    extra: {
      kind: "chips",
      label: "ALPN offered",
      items: fp.tls.alpn.length ? fp.tls.alpn : ["none"],
      active: fp.tls.negotiated_alpn,
    },
  });

  if (fp.http2) {
    sections.push({
      id: "http2",
      title: "HTTP/2",
      weight: "md",
      fields: [
        {
          label: "Pseudo-header order",
          value: fp.http2.pseudo_header_order.join(", "),
          mono: true,
        },
        {
          label: "Window update",
          value:
            fp.http2.window_update === null
              ? "none"
              : fp.http2.window_update.toLocaleString(),
          mono: true,
        },
        {
          label: "PRIORITY frames",
          value: String(fp.http2.priorities.length),
          mono: true,
        },
        ...fp.http2.settings.map((s) => ({
          label: s.name.toLowerCase().replace(/_/g, " "),
          value: s.value.toLocaleString(),
          mono: true,
        })),
      ],
    });
  }

  if (fp.http1) {
    sections.push({
      id: "http1",
      title: "HTTP/1.1 header order",
      weight: "md",
      fields: fp.http1.headers.map(([k, v]) => ({
        label: k,
        value: v,
        mono: true,
      })),
    });
  }

  sections.push({
    id: "connection",
    title: "Connection",
    weight: "sm",
    fields: [
      { label: "IP", value: fp.ip, mono: true },
      { label: "Protocol", value: fp.protocol, mono: true },
      { label: "User-Agent", value: fp.user_agent ?? "not sent", mono: true },
    ],
  });

  return sections;
}
