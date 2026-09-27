//! Remote URLs: how checkouts on different machines are recognised as one repository, and the
//! form of a remote that is safe to share and clone from. URLs are parsed with the WHATWG
//! algorithm, as the TypeScript agent's `URL` does, so both agents agree on every result.

use url::Url;

use crate::protocol::RepositoryIdentity;

/// Characters JavaScript's `.` doesn't match, which end a regular expression's `.+`.
fn is_line_break(character: char) -> bool {
    matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `^(?:[^@/]+@)?(?<host>[^:/]+):(?!\/)(?<path>.+)$`
fn scp_like(remote: &str) -> Option<(&str, &str)> {
    let host_and_path = |rest: &str| -> Option<(usize, usize)> {
        let host_end = rest.find([':', '/'])?;

        if host_end == 0 || !rest[host_end..].starts_with(':') {
            return None;
        }

        let path = &rest[host_end + 1..];

        (!path.is_empty() && !path.starts_with('/') && !path.contains(is_line_break))
            .then_some((host_end, host_end + 1))
    };

    if let Some(at) = remote.find('@')
        && at > 0
        && !remote[..at].contains('/')
    {
        let rest = &remote[at + 1..];

        if let Some((host_end, path_start)) = host_and_path(rest) {
            return Some((&rest[..host_end], &rest[path_start..]));
        }
    }

    host_and_path(remote).map(|(host_end, path_start)| (&remote[..host_end], &remote[path_start..]))
}

/// JavaScript's `decodeURIComponent`, which refuses malformed escapes.
fn decode_uri_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;

            decoded.push(
                u8::from_str_radix(hex, 16)
                    .ok()
                    .filter(|_| hex.bytes().all(|byte| byte.is_ascii_hexdigit()))?,
            );
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }

    String::from_utf8(decoded).ok()
}

fn parse_url(remote: &str) -> Option<Url> {
    Url::parse(remote).ok()
}

/// Normalises a Git remote URL so SSH, SCP-like and HTTPS forms of the same repository compare
/// equal. Returns None for local paths and URLs without a repository path.
pub fn remote_identity(remote: &str) -> Option<RepositoryIdentity> {
    let trimmed = remote.trim();
    // SCP-like remotes such as `github.com:acme/shop` also parse as URLs with a `github.com:` scheme.
    let (host, path) = match parse_url(trimmed).filter(|_| trimmed.contains("://")) {
        Some(url) => {
            let host = url.host_str().unwrap_or("");

            if url.scheme() == "file" || host.is_empty() {
                return None;
            }

            (host.to_string(), decode_uri_component(url.path())?)
        }
        None => {
            let (host, path) = scp_like(trimmed)?;

            (host.to_string(), path.to_string())
        }
    };

    let without_suffix = path
        .strip_suffix(".git/")
        .or_else(|| path.strip_suffix(".git"))
        .unwrap_or(&path);
    let normalised = without_suffix.trim_matches('/').to_lowercase();

    if normalised.is_empty() {
        return None;
    }

    Some(RepositoryIdentity::Remote {
        host: host.to_lowercase(),
        path: normalised,
    })
}

/// JavaScript's `\s` and `\p{Cc}`.
fn is_unsafe(character: char) -> bool {
    character.is_whitespace() || character.is_control() || character == '\u{feff}'
}

/// The form of a remote URL that is safe to share and clone from: HTTPS without credentials, or
/// SSH in URL or SCP-like form. Returns None for local paths, other transports, URLs that could
/// pass for a Git option, and anything without a repository path.
pub fn cloneable_url(remote: &str) -> Option<String> {
    let trimmed = remote.trim();

    // A host starting with `-` could reach SSH as an option.
    match remote_identity(trimmed) {
        Some(RepositoryIdentity::Remote { host, .. }) if !host.starts_with('-') => {}
        _ => return None,
    }

    if trimmed.starts_with('-') || trimmed.contains(is_unsafe) {
        return None;
    }

    if !trimmed.contains("://") {
        return Some(trimmed.to_string());
    }

    // An SCP-like remote whose path happens to contain `://` is not a URL.
    let mut url = parse_url(trimmed)?;

    match url.scheme() {
        "https" => {
            let _ = url.set_username("");
            let _ = url.set_password(None);
        }
        "ssh" => {
            let _ = url.set_password(None);
        }
        _ => return None,
    }

    Some(url.to_string())
}

/// The URL without a password, or without any credentials for HTTP, for the audit log.
pub fn without_credentials(remote: &str) -> String {
    let Some(mut url) = parse_url(remote).filter(|_| remote.contains("://")) else {
        return remote.to_string();
    };

    let _ = url.set_password(None);

    if matches!(url.scheme(), "https" | "http") {
        let _ = url.set_username("");
    }

    url.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(remote: &str) -> Option<String> {
        remote_identity(remote).map(|identity| identity.key())
    }

    #[test]
    fn recognises_every_form_of_a_remote() {
        let expected = Some("remote:github.com/acme/shop".to_string());

        assert_eq!(identity("git@github.com:Acme/Shop.git"), expected);
        assert_eq!(
            identity("https://user:secret@GitHub.com/acme/shop/"),
            expected
        );
        assert_eq!(identity("ssh://git@github.com/acme/shop.git"), expected);
        assert_eq!(identity("github.com:acme/shop"), expected);
        assert_eq!(
            identity("https://gitlab.com/group/sub/project.git"),
            Some("remote:gitlab.com/group/sub/project".into())
        );
        assert_eq!(identity("/srv/git/shop.git"), None);
        assert_eq!(identity("file:///srv/git/shop.git"), None);
        assert_eq!(identity("https://github.com/"), None);
        assert_eq!(identity("https://github.com/a%zzb"), None);
        assert_eq!(
            identity("https://github.com/caf%C3%A9/x"),
            Some("remote:github.com/café/x".into())
        );
    }

    #[test]
    fn shares_only_safe_clone_urls() {
        assert_eq!(
            cloneable_url("https://user:token@github.com/acme/shop.git").as_deref(),
            Some("https://github.com/acme/shop.git")
        );
        assert_eq!(
            cloneable_url("ssh://git:pw@github.com/acme/shop.git").as_deref(),
            Some("ssh://git@github.com/acme/shop.git")
        );
        assert_eq!(
            cloneable_url("git@github.com:acme/shop.git").as_deref(),
            Some("git@github.com:acme/shop.git")
        );
        assert_eq!(
            cloneable_url("HTTPS://GitHub.com:443/acme/shop").as_deref(),
            Some("https://github.com/acme/shop")
        );
        assert_eq!(cloneable_url("http://github.com/acme/shop"), None);
        assert_eq!(cloneable_url("-oProxyCommand=x:acme/shop"), None);
        assert_eq!(cloneable_url("git@github.com:acme/shop x"), None);
        assert_eq!(cloneable_url("/srv/git/shop"), None);
    }

    #[test]
    fn strips_credentials_for_the_log() {
        assert_eq!(without_credentials("https://u:p@host/x"), "https://host/x");
        assert_eq!(without_credentials("ssh://u:p@host/x"), "ssh://u@host/x");
        assert_eq!(without_credentials("git@host:x"), "git@host:x");
    }
}
