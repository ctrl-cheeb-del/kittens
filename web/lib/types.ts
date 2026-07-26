/** Mirrors the JSON emitted by the Rust origin's /api/all. */

export interface ProtocolValue {
  value: number;
  hex: string;
  name: string;
  grease: boolean;
}

export interface ExtensionInfo extends ProtocolValue {
  length: number;
}

export interface TlsInfo {
  negotiated_version: string | null;
  negotiated_cipher: string | null;
  negotiated_alpn: string | null;
  legacy_version: string;
  effective_version: string;
  sni: string | null;
  session_id_length: number;
  cipher_suites: ProtocolValue[];
  extensions: ExtensionInfo[];
  supported_groups: ProtocolValue[];
  supported_versions: ProtocolValue[];
  signature_algorithms: ProtocolValue[];
  key_share_groups: ProtocolValue[];
  cert_compression: ProtocolValue[];
  ec_point_formats: string[];
  psk_key_exchange_modes: string[];
  compression_methods: number[];
  alpn: string[];
  application_settings: string[];
  record_size_limit: number | null;
}

export interface SettingInfo {
  id: number;
  name: string;
  value: number;
}

export interface PriorityInfo {
  stream_id: number;
  exclusive: boolean;
  depends_on: number;
  weight: number;
}

export interface Http2Info {
  akamai_fingerprint: string;
  akamai_fingerprint_hash: string;
  settings: SettingInfo[];
  window_update: number | null;
  priorities: PriorityInfo[];
  pseudo_header_order: string[];
  headers: [string, string][];
}

export interface Http1Info {
  method: string;
  path: string;
  version: string;
  headers: [string, string][];
  header_order: string[];
}

export interface Fingerprint {
  kittens: { service: string; version: string; docs: string };
  ip: string;
  protocol: string;
  method: string;
  path: string;
  user_agent: string | null;
  tls: TlsInfo;
  ja3: string;
  ja3_hash: string;
  ja4: string;
  ja4_r: string;
  ja4_parts: { a: string; b: string; c: string; b_raw: string; c_raw: string };
  http2?: Http2Info;
  http1?: Http1Info;
}
