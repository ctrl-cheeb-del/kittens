/**
 * Identify the client stack from handshake evidence.
 *
 * Deliberately not a lookup table of JA4 hashes. Published hash tables go stale
 * every browser release, and a table can only ever answer "yes" or "no" — it
 * can't tell you *why*. Classifying from the extensions and frames a stack
 * actually emits stays valid across versions and shows its working.
 *
 * The payoff is the consistency check: a client claiming to be Chrome while
 * sending an OpenSSL handshake is exactly what someone testing an impersonation
 * library needs to see.
 */

import type { Fingerprint } from "./types";

export type Family =
  | "Chromium"
  | "Firefox"
  | "Safari"
  | "OpenSSL / curl"
  | "Go"
  | "Python"
  | "Node.js"
  | "Unknown";

export interface Signal {
  /** What was observed, in the client's own vocabulary. */
  observed: string;
  /** What it implies. */
  implies: Family;
  weight: number;
}

export interface Classification {
  family: Family;
  /** 0–100. Share of the winning family's evidence that was actually found. */
  confidence: number;
  signals: Signal[];
  uaFamily: Family | null;
  uaRaw: string | null;
  /** True when the User-Agent and the handshake disagree. */
  mismatch: boolean;
}

// Chrome moved ALPS from the old codepoint to the new one (BoringSSL
// 17513 -> 17613). Current Chrome sends only 0x44cd, so recognising just the
// old value makes a modern Chrome look like it has no ALPS at all — which
// reads as Safari.
const EXT_ALPS = 0x44cd;
const EXT_ALPS_OLD = 0x4469;
const EXT_RECORD_SIZE_LIMIT = 0x001c;
const EXT_DELEGATED_CREDENTIALS = 0x0022;
const EXT_COMPRESS_CERT = 0x001b;
const EXT_ENCRYPTED_CLIENT_HELLO = 0xfe0d;
const EXT_SESSION_TICKET = 0x0023;
const EXT_PSK_KEY_EXCHANGE_MODES = 0x002d;
const GROUP_X25519MLKEM768 = 0x11ec;

/** Read the User-Agent's own claim, which may or may not be true. */
export function familyFromUserAgent(ua: string | null): Family | null {
  if (!ua) return null;
  const s = ua.toLowerCase();

  if (s.includes("curl/")) return "OpenSSL / curl";
  if (s.includes("python-requests") || s.includes("python-urllib") || s.includes("aiohttp"))
    return "Python";
  if (s.includes("go-http-client")) return "Go";
  if (s.includes("node") || s.includes("undici") || s.includes("axios")) return "Node.js";

  if (s.includes("firefox/") || s.includes("fxios")) return "Firefox";
  // Chromium derivatives all still identify as Chrome.
  if (s.includes("edg/") || s.includes("opr/") || s.includes("chrome/") || s.includes("crios"))
    return "Chromium";
  // Safari only after Chrome has been ruled out — Chrome's UA also says Safari.
  if (s.includes("safari/") && s.includes("version/")) return "Safari";

  return null;
}

/** Pretty version string from the UA, purely for display. */
export function versionFromUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  const patterns: [RegExp, string][] = [
    [/edg\/(\d+)/i, "Edge"],
    [/opr\/(\d+)/i, "Opera"],
    [/firefox\/(\d+)/i, "Firefox"],
    [/chrome\/(\d+)/i, "Chrome"],
    [/version\/(\d+[\d.]*) safari/i, "Safari"],
    [/curl\/([\d.]+)/i, "curl"],
  ];
  for (const [re, label] of patterns) {
    const m = ua.match(re);
    if (m) return `${label} ${m[1]}`;
  }
  return null;
}

function platformFromUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  if (/windows nt 10/i.test(ua)) return "Windows";
  if (/mac os x/i.test(ua)) return "macOS";
  if (/android/i.test(ua)) return "Android";
  if (/(iphone|ipad|ios)/i.test(ua)) return "iOS";
  if (/linux/i.test(ua)) return "Linux";
  return null;
}

export function describeClient(fp: Fingerprint): string {
  const version = versionFromUserAgent(fp.user_agent);
  const platform = platformFromUserAgent(fp.user_agent);
  if (version && platform) return `${version} on ${platform}`;
  if (version) return version;
  return "Unrecognised client";
}

/** Total evidence available per family, used to normalise confidence. */
const MAX_WEIGHT: Record<Family, number> = {
  Chromium: 10,
  Firefox: 10,
  Safari: 6,
  "OpenSSL / curl": 6,
  Go: 4,
  Python: 4,
  "Node.js": 4,
  Unknown: 1,
};

export function classify(fp: Fingerprint): Classification {
  const signals: Signal[] = [];
  const extensions = new Set(fp.tls.extensions.map((e) => e.value));
  const groups = new Set(fp.tls.supported_groups.map((g) => g.value));
  const hasGrease = fp.tls.cipher_suites.some((c) => c.grease);
  const pseudo = fp.http2?.pseudo_header_order.join(",") ?? null;
  const settingIds = fp.http2?.settings.map((s) => s.id).join(",") ?? null;

  const add = (observed: string, implies: Family, weight: number) =>
    signals.push({ observed, implies, weight });

  // --- Chromium ---------------------------------------------------------
  if (extensions.has(EXT_ALPS) || extensions.has(EXT_ALPS_OLD)) {
    // ALPS is a Google extension; no other production stack sends it.
    add("application_settings (ALPS) extension", "Chromium", 4);
  }
  if (extensions.has(EXT_COMPRESS_CERT)) {
    add("compress_certificate extension", "Chromium", 2);
  }
  if (pseudo === "m,a,s,p") {
    add("pseudo-header order m,a,s,p", "Chromium", 2);
  }
  if (settingIds === "1,2,3,4,6") {
    add("SETTINGS 1,2,3,4,6 in Chromium's order", "Chromium", 2);
  }

  // --- Firefox ----------------------------------------------------------
  if (extensions.has(EXT_RECORD_SIZE_LIMIT)) {
    // NSS sends record_size_limit; BoringSSL does not.
    add("record_size_limit extension (NSS)", "Firefox", 4);
  }
  if (extensions.has(EXT_DELEGATED_CREDENTIALS)) {
    add("delegated_credentials extension", "Firefox", 2);
  }
  if (pseudo === "m,p,a,s") {
    add("pseudo-header order m,p,a,s", "Firefox", 2);
  }
  if ((fp.http2?.priorities.length ?? 0) >= 3) {
    add(`${fp.http2?.priorities.length} PRIORITY frames (dependency tree)`, "Firefox", 2);
  }

  // --- Safari -----------------------------------------------------------
  // Apple's stack GREASEs like Chromium but sends neither ALPS nor
  // record_size_limit, so it is identified by that absence.
  if (
    hasGrease &&
    !extensions.has(EXT_ALPS) &&
    !extensions.has(EXT_ALPS_OLD) &&
    !extensions.has(EXT_RECORD_SIZE_LIMIT)
  ) {
    add("GREASE without ALPS or record_size_limit", "Safari", 3);
  }
  if (pseudo === "m,s,p,a") {
    add("pseudo-header order m,s,p,a", "Safari", 3);
  }

  // --- Command-line and library stacks ----------------------------------
  if (!hasGrease) {
    // Every modern browser GREASEs. Its absence is the loudest single signal
    // that this is not a browser at all.
    add("no GREASE values (not a browser engine)", "OpenSSL / curl", 3);
  }
  if (pseudo === "m,s,a,p") {
    add("pseudo-header order m,s,a,p (nghttp2)", "OpenSSL / curl", 2);
  }
  if (settingIds === "3,4,2") {
    add("SETTINGS 3,4,2 (nghttp2 defaults)", "OpenSSL / curl", 1);
  }
  if (!hasGrease && !extensions.has(EXT_SESSION_TICKET) && fp.tls.alpn.length === 0) {
    add("no ALPN offered", "Python", 2);
  }
  if (!hasGrease && extensions.has(EXT_PSK_KEY_EXCHANGE_MODES) && fp.tls.alpn.join(",") === "h2,http/1.1") {
    add("Go crypto/tls extension profile", "Go", 2);
  }

  // --- Recency, not identity -------------------------------------------
  if (groups.has(GROUP_X25519MLKEM768)) {
    add("X25519MLKEM768 post-quantum key share (2024+ build)", "Chromium", 1);
  }
  if (extensions.has(EXT_ENCRYPTED_CLIENT_HELLO)) {
    add("Encrypted Client Hello", "Chromium", 1);
  }

  // Score families by summed weight.
  const totals = new Map<Family, number>();
  for (const s of signals) {
    totals.set(s.implies, (totals.get(s.implies) ?? 0) + s.weight);
  }

  let family: Family = "Unknown";
  let best = 0;
  for (const [f, score] of totals) {
    if (score > best) {
      best = score;
      family = f;
    }
  }

  const confidence =
    family === "Unknown"
      ? 0
      : Math.min(100, Math.round((best / MAX_WEIGHT[family]) * 100));

  const uaFamily = familyFromUserAgent(fp.user_agent);
  // Only flag a mismatch when both sides actually said something.
  const mismatch =
    uaFamily !== null && family !== "Unknown" && uaFamily !== family && confidence >= 40;

  // Sort the winner's evidence to the top. Leading with a signal that
  // contradicts the verdict reads as a bug, even when the tally is right.
  const ordered = [...signals].sort((a, b) => {
    const aWins = a.implies === family ? 1 : 0;
    const bWins = b.implies === family ? 1 : 0;
    if (aWins !== bWins) return bWins - aWins;
    return b.weight - a.weight;
  });

  return {
    family,
    confidence,
    signals: ordered,
    uaFamily,
    uaRaw: fp.user_agent,
    mismatch,
  };
}

/** The verdict, in as few words as it takes. */
export function headline(v: Classification): string {
  if (v.family === "Unknown") return "Handshake matches nothing we know.";
  return `Handshake reads as ${v.family}.`;
}

/** One supporting line, or nothing. */
export function subline(fp: Fingerprint, v: Classification): string | null {
  const claim = describeClient(fp);
  if (v.mismatch) return `User-Agent claims ${claim}. It isn't.`;
  if (claim === "Unrecognised client") return null;
  return `Claims ${claim}.`;
}

export function moodFor(v: Classification): "content" | "suspicious" | "curious" {
  if (v.mismatch) return "suspicious";
  if (v.family === "Unknown") return "curious";
  return "content";
}
