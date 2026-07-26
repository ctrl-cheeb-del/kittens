//! IANA registry names for the values that show up in a ClientHello.
//!
//! Purely cosmetic — nothing here feeds a fingerprint. It exists so the UI can
//! render "TLS_AES_128_GCM_SHA256 (0x1301)" instead of "4865", which is the
//! difference between a JSON dump and something a person can read.
//!
//! Unknown values render as "UNKNOWN (0x....)" rather than being dropped: new
//! cipher suites and extensions appear regularly and a blank cell would look
//! like a parser bug.

pub fn cipher_suite(v: u16) -> &'static str {
    match v {
        0x0000 => "TLS_NULL_WITH_NULL_NULL",
        0x000a => "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
        0x002f => "TLS_RSA_WITH_AES_128_CBC_SHA",
        0x0035 => "TLS_RSA_WITH_AES_256_CBC_SHA",
        0x003c => "TLS_RSA_WITH_AES_128_CBC_SHA256",
        0x003d => "TLS_RSA_WITH_AES_256_CBC_SHA256",
        0x009c => "TLS_RSA_WITH_AES_128_GCM_SHA256",
        0x009d => "TLS_RSA_WITH_AES_256_GCM_SHA384",
        // TLS 1.3
        0x1301 => "TLS_AES_128_GCM_SHA256",
        0x1302 => "TLS_AES_256_GCM_SHA384",
        0x1303 => "TLS_CHACHA20_POLY1305_SHA256",
        0x1304 => "TLS_AES_128_CCM_SHA256",
        0x1305 => "TLS_AES_128_CCM_8_SHA256",
        // ECDHE
        0xc009 => "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA",
        0xc00a => "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA",
        0xc012 => "TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA",
        0xc013 => "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
        0xc014 => "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
        0xc023 => "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256",
        0xc024 => "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA384",
        0xc027 => "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
        0xc028 => "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384",
        0xc02b => "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
        0xc02c => "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
        0xc02f => "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
        0xc030 => "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
        0xcca8 => "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
        0xcca9 => "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
        0x00ff => "TLS_EMPTY_RENEGOTIATION_INFO_SCSV",
        _ => "UNKNOWN",
    }
}

pub fn extension(v: u16) -> &'static str {
    match v {
        0x0000 => "server_name",
        0x0001 => "max_fragment_length",
        0x0005 => "status_request",
        0x000a => "supported_groups",
        0x000b => "ec_point_formats",
        0x000d => "signature_algorithms",
        0x000e => "use_srtp",
        0x000f => "heartbeat",
        0x0010 => "application_layer_protocol_negotiation",
        0x0011 => "status_request_v2",
        0x0012 => "signed_certificate_timestamp",
        0x0013 => "client_certificate_type",
        0x0014 => "server_certificate_type",
        0x0015 => "padding",
        0x0016 => "encrypt_then_mac",
        0x0017 => "extended_master_secret",
        0x0018 => "token_binding",
        0x001b => "compress_certificate",
        0x001c => "record_size_limit",
        0x0022 => "delegated_credentials",
        0x0023 => "session_ticket",
        0x0029 => "pre_shared_key",
        0x002a => "early_data",
        0x002b => "supported_versions",
        0x002c => "cookie",
        0x002d => "psk_key_exchange_modes",
        0x002f => "certificate_authorities",
        0x0031 => "post_handshake_auth",
        0x0032 => "signature_algorithms_cert",
        0x0033 => "key_share",
        0x0039 => "quic_transport_parameters",
        0x001a => "trusted_ca_keys",
        0xfd00 => "encrypted_client_hello_outer_extensions",
        0xfe0d => "encrypted_client_hello",
        0xff01 => "renegotiation_info",
        0x4469 => "application_settings",
        0x4468 => "application_settings_old",
        0x754f => "extended_key_update",
        _ => "UNKNOWN",
    }
}

pub fn supported_group(v: u16) -> &'static str {
    match v {
        0x0017 => "secp256r1",
        0x0018 => "secp384r1",
        0x0019 => "secp521r1",
        0x001d => "x25519",
        0x001e => "x448",
        0x0100 => "ffdhe2048",
        0x0101 => "ffdhe3072",
        0x0102 => "ffdhe4096",
        // Post-quantum hybrids. X25519MLKEM768 is what current Chrome and
        // Firefox lead with, and its presence is a strong version signal.
        0x11ec => "X25519MLKEM768",
        0x6399 => "X25519Kyber768Draft00",
        0x639a => "P256Kyber768Draft00",
        0x0201 => "MLKEM512",
        0x0202 => "MLKEM768",
        0x0203 => "MLKEM1024",
        _ => "UNKNOWN",
    }
}

pub fn signature_algorithm(v: u16) -> &'static str {
    match v {
        0x0201 => "rsa_pkcs1_sha1",
        0x0203 => "ecdsa_sha1",
        0x0401 => "rsa_pkcs1_sha256",
        0x0403 => "ecdsa_secp256r1_sha256",
        0x0420 => "rsa_pkcs1_sha256_legacy",
        0x0501 => "rsa_pkcs1_sha384",
        0x0503 => "ecdsa_secp384r1_sha384",
        0x0601 => "rsa_pkcs1_sha512",
        0x0603 => "ecdsa_secp521r1_sha512",
        0x0704 => "ed25519",
        0x0705 => "ed448",
        0x0804 => "rsa_pss_rsae_sha256",
        0x0805 => "rsa_pss_rsae_sha384",
        0x0806 => "rsa_pss_rsae_sha512",
        0x0807 => "ed25519_alt",
        0x0809 => "rsa_pss_pss_sha256",
        0x080a => "rsa_pss_pss_sha384",
        0x080b => "rsa_pss_pss_sha512",
        _ => "UNKNOWN",
    }
}

pub fn tls_version(v: u16) -> &'static str {
    match v {
        0x0304 => "TLS 1.3",
        0x0303 => "TLS 1.2",
        0x0302 => "TLS 1.1",
        0x0301 => "TLS 1.0",
        0x0300 => "SSL 3.0",
        0x0002 => "SSL 2.0",
        _ => "UNKNOWN",
    }
}

pub fn ec_point_format(v: u8) -> &'static str {
    match v {
        0 => "uncompressed",
        1 => "ansiX962_compressed_prime",
        2 => "ansiX962_compressed_char2",
        _ => "UNKNOWN",
    }
}

pub fn cert_compression(v: u16) -> &'static str {
    match v {
        1 => "zlib",
        2 => "brotli",
        3 => "zstd",
        _ => "UNKNOWN",
    }
}

pub fn psk_key_exchange_mode(v: u8) -> &'static str {
    match v {
        0 => "psk_ke",
        1 => "psk_dhe_ke",
        _ => "UNKNOWN",
    }
}

/// Render as `name (0xNNNN)`, or `GREASE (0xNNNN)` for GREASE values, which
/// would otherwise all show as UNKNOWN and look like gaps in the table.
pub fn labelled(v: u16, f: fn(u16) -> &'static str) -> String {
    if super::parse::is_grease(v) {
        return format!("GREASE (0x{v:04x})");
    }
    format!("{} (0x{v:04x})", f(v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_include_hex() {
        assert_eq!(labelled(0x1301, cipher_suite), "TLS_AES_128_GCM_SHA256 (0x1301)");
        assert_eq!(labelled(0x002b, extension), "supported_versions (0x002b)");
        assert_eq!(labelled(0x11ec, supported_group), "X25519MLKEM768 (0x11ec)");
    }

    #[test]
    fn grease_is_labelled_not_unknown() {
        assert_eq!(labelled(0x0a0a, cipher_suite), "GREASE (0x0a0a)");
        assert_eq!(labelled(0xfafa, extension), "GREASE (0xfafa)");
    }

    #[test]
    fn unknown_values_still_render() {
        assert_eq!(labelled(0xbeef, cipher_suite), "UNKNOWN (0xbeef)");
    }
}
