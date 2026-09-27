//! TLS to the hub: publicly trusted certificates, or the hub's self-signed certificate pinned at
//! pairing by its SHA-256 fingerprint. A pinned certificate is tied to the hub rather than to an
//! address, so it replaces the hostname check.
//!
//! Hubs issue X.509 v1 certificates, which webpki refuses to parse, so a pinned connection checks
//! the handshake's signature against the public key read from the certificate itself. Node's hub
//! negotiates TLS 1.3, which is all a pinned connection offers.

use std::sync::{Arc, Mutex};

use base64::Engine;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls13_signature_with_raw_key};
use rustls::pki_types::{CertificateDer, ServerName, SubjectPublicKeyInfoDer, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, Error, RootCertStore, SignatureScheme};

fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// A certificate's SHA-256 fingerprint in Node's `AB:CD:…` form, as pairing strings carry it.
pub fn fingerprint(der: &[u8]) -> String {
    ring::digest::digest(&ring::digest::SHA256, der)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

pub fn to_pem(der: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(der);
    let lines: Vec<&str> = encoded
        .as_bytes()
        .chunks(64)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or_default())
        .collect();

    format!(
        "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
        lines.join("\n")
    )
}

pub fn from_pem(pem: &str) -> Option<Vec<u8>> {
    let body: String = pem
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("-----"))
        .collect();

    base64::engine::general_purpose::STANDARD.decode(body).ok()
}

/// One DER element within a larger encoding.
struct Element<'a> {
    tag: u8,
    /// The element's whole encoding, with its tag and length.
    whole: &'a [u8],
    contents: &'a [u8],
    /// What follows the element.
    rest: &'a [u8],
}

fn der_element(input: &[u8]) -> Option<Element<'_>> {
    let tag = *input.first()?;
    let first = *input.get(1)?;
    let (length, header) = if first < 0x80 {
        (usize::from(first), 2)
    } else {
        let bytes = usize::from(first & 0x7f);

        if bytes == 0 || bytes > 4 {
            return None;
        }

        let length = input
            .get(2..2 + bytes)?
            .iter()
            .fold(0usize, |length, byte| (length << 8) | usize::from(*byte));

        (length, 2 + bytes)
    };
    let end = header.checked_add(length)?;

    Some(Element {
        tag,
        whole: input.get(..end)?,
        contents: input.get(header..end)?,
        rest: &input[end..],
    })
}

/// The certificate's SubjectPublicKeyInfo, from any X.509 version (RFC 5280 §4.1).
fn subject_public_key_info(certificate: &[u8]) -> Option<&[u8]> {
    const SEQUENCE: u8 = 0x30;
    const VERSION: u8 = 0xa0;

    let certificate = der_element(certificate).filter(|element| element.tag == SEQUENCE)?;
    let to_be_signed =
        der_element(certificate.contents).filter(|element| element.tag == SEQUENCE)?;
    let mut fields = to_be_signed.contents;

    if fields.first() == Some(&VERSION) {
        fields = der_element(fields)?.rest;
    }

    // The serial number, signature algorithm, issuer, validity and subject come first.
    for _ in 0..5 {
        fields = der_element(fields)?.rest;
    }

    der_element(fields)
        .filter(|element| element.tag == SEQUENCE)
        .map(|element| element.whole)
}

/// Accepts the one certificate whose fingerprint matches, or with `seen`, any certificate, which
/// it records so pairing can compare it with the pairing string before sending anything. Either
/// way the handshake must be signed by the certificate's key.
#[derive(Debug)]
struct FingerprintVerifier {
    expected: Option<String>,
    seen: Option<Arc<Mutex<Option<Vec<u8>>>>>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for FingerprintVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        if let Some(seen) = &self.seen {
            *seen.lock().unwrap() = Some(end_entity.to_vec());
        }

        match &self.expected {
            Some(expected) if *expected != fingerprint(end_entity) => Err(Error::General(
                "The hub's certificate does not match the one pinned at pairing".into(),
            )),
            _ => Ok(ServerCertVerified::assertion()),
        }
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        Err(Error::General(
            "A pinned hub connection uses TLS 1.3".into(),
        ))
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        let key = subject_public_key_info(cert)
            .ok_or_else(|| Error::General("The hub's certificate can't be read".into()))?;

        verify_tls13_signature_with_raw_key(
            message,
            &SubjectPublicKeyInfoDer::from(key),
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn with_verifier(verifier: FingerprintVerifier) -> ClientConfig {
    ClientConfig::builder_with_provider(provider())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .expect("ring supports TLS 1.3")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth()
}

/// TLS that trusts only the pinned hub certificate, or publicly trusted certificates without one.
pub fn client_config(certificate_pem: Option<&str>) -> Result<ClientConfig, String> {
    match certificate_pem {
        None => {
            let roots = RootCertStore {
                roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
            };

            Ok(ClientConfig::builder_with_provider(provider())
                .with_safe_default_protocol_versions()
                .expect("ring supports the default protocol versions")
                .with_root_certificates(roots)
                .with_no_client_auth())
        }
        Some(pem) => {
            let der = from_pem(pem).ok_or("The pinned hub certificate can't be read")?;

            Ok(with_verifier(FingerprintVerifier {
                expected: Some(fingerprint(&der)),
                seen: None,
                provider: provider(),
            }))
        }
    }
}

/// TLS that accepts any certificate, recording the one the hub presents in `seen`.
pub fn recording_config(seen: Arc<Mutex<Option<Vec<u8>>>>) -> ClientConfig {
    with_verifier(FingerprintVerifier {
        expected: None,
        seen: Some(seen),
        provider: provider(),
    })
}

pub fn server_name(host: &str) -> Result<ServerName<'static>, String> {
    // URLs keep the brackets around IPv6 literals, which name lookup does not accept.
    let bare = host
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .unwrap_or(host);

    ServerName::try_from(bare.to_string()).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A version 1 certificate as a hub makes one, with a P-256 key.
    const HUB_CERTIFICATE: &str = "-----BEGIN CERTIFICATE-----
MIIBJjCBzQIQQED7797Q52qBS0HnaZauvjAKBggqhkjOPQQDAjAYMRYwFAYDVQQD
DA1GbGVldEZyb2cgaHViMB4XDTI2MDkyNjEwNTIwM1oXDTQ2MDkyNzEwNTIwM1ow
GDEWMBQGA1UEAwwNRmxlZXRGcm9nIGh1YjBZMBMGByqGSM49AgEGCCqGSM49AwEH
A0IABNCtRRkVS7WClj9pPbcCdTMdWD82C6yIfneAUWgpuouO5W4C+PickZ9Cmv+i
rKU5jEmdfc2VD133vXZ8AjeK+GUwCgYIKoZIzj0EAwIDSAAwRQIhAJ/D+Lx2KFHE
bQhJfbdaxW4qqwnNR/2ZtrIeAPlM4AAOAiBGr8dHn7UvzEOWxF7Tjz1OatXewMPI
PvfWkd/efW73hQ==
-----END CERTIFICATE-----";

    #[test]
    fn round_trips_pem_and_formats_fingerprints() {
        let der = vec![1u8, 2, 3, 250];

        assert_eq!(from_pem(&to_pem(&der)), Some(der));
        assert_eq!(fingerprint(b"").len(), 32 * 3 - 1);
        assert!(fingerprint(b"").starts_with("E3:B0:C4:42"));
    }

    #[test]
    fn reads_the_public_key_of_a_version_1_certificate() {
        let der = from_pem(HUB_CERTIFICATE).unwrap();
        let key = subject_public_key_info(&der).unwrap();

        // An EC public key info: the id-ecPublicKey algorithm, then the 65-byte P-256 point.
        assert_eq!(&key[..4], &[0x30, 0x59, 0x30, 0x13]);
        assert_eq!(key.len(), 0x59 + 2);
        assert!(subject_public_key_info(&der[..40]).is_none());
    }
}
