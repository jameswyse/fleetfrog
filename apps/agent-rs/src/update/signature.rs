//! Checking the OpenSSH signature each release makes over its `SHA256SUMS`, as
//! `ssh-keygen -Y verify` would. The format is OpenSSH's `PROTOCOL.sshsig`, and only ed25519 keys
//! are accepted, since the release key is one.

use base64::Engine;
use ring::digest;
use ring::signature::{ED25519, UnparsedPublicKey};

/// The key releases are signed with, which `docs/releasing.md` describes. A test checks that
/// `scripts/release/install.sh` carries the same key, and the release workflow checks each new
/// signature against the script's copy.
pub const RELEASE_KEY: &str =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGEsrE7jwC7DdJ4pIDehO+UYjB5F4GRznUVT8S4iHmse";

/// The namespace releases are signed in, so a signature the key makes for anything else can't
/// pass for a release's.
pub const NAMESPACE: &str = "fleetfrog-release";

const KEY_TYPE: &[u8] = b"ssh-ed25519";
const MAGIC: &[u8] = b"SSHSIG";
const BEGIN: &str = "-----BEGIN SSH SIGNATURE-----";
const END: &str = "-----END SSH SIGNATURE-----";

/// Reads the big-endian lengths and length-prefixed strings SSH encodes its data with.
struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let (taken, rest) = self.0.split_at_checked(count)?;

        self.0 = rest;
        Some(taken)
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_be_bytes(self.take(4)?.try_into().ok()?))
    }

    fn string(&mut self) -> Option<&'a [u8]> {
        let length = self.u32()?;

        self.take(usize::try_from(length).ok()?)
    }

    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

fn put_string(out: &mut Vec<u8>, bytes: &[u8]) {
    let length = u32::try_from(bytes.len()).expect("a signed field fits a 32-bit length");

    out.extend_from_slice(&length.to_be_bytes());
    out.extend_from_slice(bytes);
}

/// The ed25519 key a blob of `string "ssh-ed25519" || string key` holds.
fn ed25519_key(blob: &[u8]) -> Option<&[u8]> {
    let mut reader = Reader(blob);

    (reader.string()? == KEY_TYPE)
        .then(|| reader.string())
        .flatten()
        .filter(|key| key.len() == 32 && reader.is_empty())
}

/// The key blob of a public key line such as `ssh-ed25519 AAAA... comment`.
fn public_key_blob(line: &str) -> Option<Vec<u8>> {
    let mut fields = line.split_whitespace();

    if fields.next()?.as_bytes() != KEY_TYPE {
        return None;
    }

    let blob = base64::engine::general_purpose::STANDARD
        .decode(fields.next()?)
        .ok()?;

    ed25519_key(&blob).is_some().then_some(blob)
}

/// Checks that `armored`, an armored SSHSIG file, is `public_key`'s signature over `message` in
/// the release namespace. `public_key` is a public key line, such as [`RELEASE_KEY`]. The error
/// says what didn't check out.
pub fn verify(public_key: &str, message: &[u8], armored: &str) -> Result<(), &'static str> {
    let expected_blob =
        public_key_blob(public_key).ok_or("the release key isn't an ed25519 key")?;
    let encoded: String = armored
        .trim()
        .strip_prefix(BEGIN)
        .and_then(|rest| rest.strip_suffix(END))
        .ok_or("it isn't an SSH signature")?
        .split_whitespace()
        .collect();
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "it isn't an SSH signature")?;
    let mut reader = Reader(&decoded);
    let malformed = "it's malformed";

    if reader.take(MAGIC.len()) != Some(MAGIC) || reader.u32() != Some(1) {
        return Err("it isn't a version 1 SSH signature");
    }

    let key_blob = reader.string().ok_or(malformed)?;
    let namespace = reader.string().ok_or(malformed)?;
    let reserved = reader.string().ok_or(malformed)?;
    let hash_algorithm = reader.string().ok_or(malformed)?;
    let signature_blob = reader.string().ok_or(malformed)?;

    if !reader.is_empty() {
        return Err(malformed);
    }

    if key_blob != expected_blob {
        return Err("it was made by another key");
    }

    if namespace != NAMESPACE.as_bytes() {
        return Err("it was made for something other than a release");
    }

    let hash = match hash_algorithm {
        b"sha512" => digest::digest(&digest::SHA512, message),
        b"sha256" => digest::digest(&digest::SHA256, message),
        _ => return Err("it uses a hash it shouldn't"),
    };
    let mut signature = Reader(signature_blob);

    if signature.string() != Some(KEY_TYPE) {
        return Err("it isn't an ed25519 signature");
    }

    let signature = signature
        .string()
        .filter(|bytes| bytes.len() == 64 && signature.is_empty())
        .ok_or(malformed)?;
    let mut signed = MAGIC.to_vec();

    put_string(&mut signed, namespace);
    put_string(&mut signed, reserved);
    put_string(&mut signed, hash_algorithm);
    put_string(&mut signed, hash.as_ref());

    let key = ed25519_key(key_blob).ok_or(malformed)?;

    UnparsedPublicKey::new(&ED25519, key)
        .verify(&signed, signature)
        .map_err(|_| "it doesn't match the checksums")
}

#[cfg(test)]
mod tests {
    use super::*;

    // Made with a throwaway key: `ssh-keygen -t ed25519 -f key`, then
    // `ssh-keygen -Y sign -f key -n <namespace> message`.
    const KEY: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGcIJ+7pcyTywwGGCQzJjs3tI5KzIpSKG1UVG5fpDNz3 test";
    const MESSAGE: &[u8] = b"abc123  fleetfrog-linux-x86_64\n";
    const SIGNATURE: &str = "-----BEGIN SSH SIGNATURE-----
U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgZwgn7ulzJPLDAYYJDMmOze0jkr
MilIobVRUbl+kM3PcAAAARZmxlZXRmcm9nLXJlbGVhc2UAAAAAAAAABnNoYTUxMgAAAFMA
AAALc3NoLWVkMjU1MTkAAABA8wgQn/z/5Pi+sAGg25o4o75A6p6RdDMHFr8hQsHNhfMkQ0
Wua2iqGfr+H7PCo8T6RZL8bmuOFLUTQevsKte8Cw==
-----END SSH SIGNATURE-----
";
    /// The same key's signature over the same message in the `file` namespace.
    const OTHER_NAMESPACE: &str = "-----BEGIN SSH SIGNATURE-----
U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgZwgn7ulzJPLDAYYJDMmOze0jkr
MilIobVRUbl+kM3PcAAAAEZmlsZQAAAAAAAAAGc2hhNTEyAAAAUwAAAAtzc2gtZWQyNTUx
OQAAAEDU3kQUu5j5Nrzo34V2gYvNCbuwhPXBWeqW2UMUsqDcDHg9keJIEiGxZELe1obKLm
CHqjQS1rq7svSinz0mrGIM
-----END SSH SIGNATURE-----
";
    /// Another throwaway key's signature over the same message in the release namespace.
    const OTHER_KEY: &str = "-----BEGIN SSH SIGNATURE-----
U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgCGlOeqa+y3VS2hNwbjR4Xx0TPm
w9YAC4czVPeaCz/fMAAAARZmxlZXRmcm9nLXJlbGVhc2UAAAAAAAAABnNoYTUxMgAAAFMA
AAALc3NoLWVkMjU1MTkAAABAN+HQsd/iAbpY79+wb3D0XucuOhalClCvtRvmgjKxmF6BDW
HurwnJXc4/ceN5tyq58gcL0PZVYHzHZ9m0bJG9Cw==
-----END SSH SIGNATURE-----
";

    #[test]
    fn accepts_the_keys_signature() {
        assert_eq!(verify(KEY, MESSAGE, SIGNATURE), Ok(()));
    }

    #[test]
    fn rejects_a_changed_message() {
        assert_eq!(
            verify(KEY, b"abc124  fleetfrog-linux-x86_64\n", SIGNATURE),
            Err("it doesn't match the checksums")
        );
    }

    #[test]
    fn rejects_a_signature_for_another_namespace() {
        assert_eq!(
            verify(KEY, MESSAGE, OTHER_NAMESPACE),
            Err("it was made for something other than a release")
        );
    }

    #[test]
    fn rejects_a_signature_from_another_key() {
        assert_eq!(
            verify(KEY, MESSAGE, OTHER_KEY),
            Err("it was made by another key")
        );
        assert_eq!(
            verify(RELEASE_KEY, MESSAGE, SIGNATURE),
            Err("it was made by another key")
        );
    }

    #[test]
    fn rejects_garbled_armor() {
        let garbled = SIGNATURE.replace("Wua2iqGfr", "Wua2iqGfs");

        assert_eq!(
            verify(KEY, MESSAGE, &garbled),
            Err("it doesn't match the checksums")
        );
        assert!(verify(KEY, MESSAGE, &SIGNATURE.replace("BEGIN SSH", "BEGIN")).is_err());
        assert!(verify(KEY, MESSAGE, &SIGNATURE[..SIGNATURE.len() / 2]).is_err());
        assert!(verify(KEY, MESSAGE, "").is_err());
    }

    #[test]
    fn reads_the_release_key() {
        assert!(public_key_blob(RELEASE_KEY).is_some());
    }

    #[test]
    fn carries_the_install_scripts_key() {
        let script = include_str!("../../../../scripts/release/install.sh");

        assert!(script.contains(&format!("\nrelease_key=\"{RELEASE_KEY}\"\n")));
    }
}
