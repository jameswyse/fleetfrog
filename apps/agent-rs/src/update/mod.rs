//! Updating the agent to its hub's version. Every FleetFrog package shares one version, and each
//! release publishes the agent's binaries with the hub image, so the hub's version names the
//! release to install. An agent never installs a version older than or the same as its own.
//!
//! Installing follows `scripts/release/install.sh`: the new binary is downloaded beside the
//! installed one and checked against the release's `SHA256SUMS`, then renamed into place. A
//! running agent keeps its old copy, and macOS runs the new one instead of refusing a binary
//! changed in place.

pub mod changelog;

use std::cmp::Ordering;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use serde_json::Value;
use url::Url;

use crate::audit::{self, AuditEntry};
use crate::config::AgentConfig;
use crate::http::{self, GetError};
use crate::hub::rpc::{HubClient, RpcError};
use crate::machine::AGENT_VERSION;
use crate::process::run_tool;
use crate::service;

/// Whether this binary came from a GitHub release, whose later releases can replace it. The
/// release workflow builds with `FLEETFROG_RELEASE=1`, and `build.rs` turns that into this cfg.
pub const UPDATES_ITSELF: bool = cfg!(fleetfrog_release);

pub const BUILT_FROM_SOURCE: &str = "This agent was built from source, so it can't update itself. Update it with Git and build it again.";

const RELEASES: &str = "https://github.com/jameswyse/fleetfrog/releases/download";

/// The download's name, as `install.sh` names it, so either cleans up after the other.
const DOWNLOAD_NAME: &str = ".fleetfrog.download";

/// A version's first three numbers, or zeros when it doesn't start with them.
fn version_numbers(version: &str) -> [u64; 3] {
    let digits = |part: &str| -> Option<u64> {
        part.bytes()
            .all(|byte| byte.is_ascii_digit())
            .then(|| part.parse().ok())?
    };
    let mut parts = version.splitn(3, '.');
    let major = parts.next().and_then(digits);
    let minor = parts.next().and_then(digits);
    // The last number may be followed by a pre-release or build suffix.
    let patch = parts.next().and_then(|part| {
        digits(
            &part[..part
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(part.len())],
        )
    });

    match (major, minor, patch) {
        (Some(major), Some(minor), Some(patch)) => [major, minor, patch],
        _ => [0; 3],
    }
}

/// Whether `version` is a plain release number such as `0.2.0`, as every FleetFrog release is.
fn is_release_version(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();

    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

/// Orders versions such as `0.1.10` and `0.2.0` by their numbers, as the protocol package's
/// `compareVersions` does, ignoring any pre-release suffix.
pub fn compare_versions(left: &str, right: &str) -> Ordering {
    version_numbers(left).cmp(&version_numbers(right))
}

/// The release asset built for this machine, as the release workflow names it.
fn asset_name() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("fleetfrog-linux-x86_64"),
        ("linux", "aarch64") => Some("fleetfrog-linux-aarch64"),
        ("macos", "aarch64") => Some("fleetfrog-macos-aarch64"),
        _ => None,
    }
}

/// The checksum `SHA256SUMS` lists for `asset`, in `sha256sum`'s format.
fn listed_checksum<'a>(sums: &'a str, asset: &str) -> Option<&'a str> {
    sums.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        let checksum = fields.next()?;
        // `sha256sum --binary` marks each name with an asterisk.
        let name = fields.next()?.trim_start_matches('*');

        (name == asset).then_some(checksum)
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    ring::digest::digest(&ring::digest::SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

async fn download(version: &str, name: &str) -> Result<Vec<u8>, String> {
    let url = Url::parse(&format!("{RELEASES}/v{version}/{name}"))
        .map_err(|error| format!("Could not form the address of {name}: {error}"))?;

    http::get(&url).await.map_err(|error| match error {
        GetError::Status(404) if name == "SHA256SUMS" => {
            format!("There is no FleetFrog {version} release on GitHub.")
        }
        GetError::Status(404) => format!("FleetFrog {version} has no {name} to download."),
        error => format!("Could not download {name} for FleetFrog {version}: {error}."),
    })
}

/// The new binary while it's checked. Dropping it removes the file unless it was moved into place,
/// including when an abandoned update stops partway.
struct Download {
    path: PathBuf,
    installed: bool,
}

impl Download {
    fn write(directory: &Path, contents: &[u8]) -> Result<Download, String> {
        let download = Download {
            path: directory.join(DOWNLOAD_NAME),
            installed: false,
        };
        let written = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o755)
            .open(&download.path)
            .and_then(|mut file| {
                file.write_all(contents)?;
                // The mode above passes through the umask, and the binary must be executable.
                file.set_permissions(std::fs::Permissions::from_mode(0o755))?;
                file.sync_all()
            });

        match written {
            Ok(()) => Ok(download),
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => Err(format!(
                "The agent can't write to {}, where it's installed. Update it as the user who installed it.",
                directory.display()
            )),
            Err(error) => Err(format!(
                "Could not save the new agent to {}: {error}.",
                download.path.display()
            )),
        }
    }

    fn install(mut self, executable: &Path) -> Result<(), String> {
        std::fs::rename(&self.path, executable).map_err(|error| {
            format!(
                "Could not replace the agent at {}: {error}.",
                executable.display()
            )
        })?;
        self.installed = true;

        Ok(())
    }
}

impl Drop for Download {
    fn drop(&mut self) {
        if !self.installed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Replaces this agent's binary with the release of `version`, which must be newer, and returns
/// where it is. The running agent carries on with its old copy until it restarts.
pub async fn install(version: &str) -> Result<PathBuf, String> {
    if !UPDATES_ITSELF {
        return Err(BUILT_FROM_SOURCE.into());
    }

    // The version becomes part of the download's address, so anything but a release number could
    // point it at another repository's files.
    if !is_release_version(version) {
        return Err(format!("\"{version}\" isn't a FleetFrog release version."));
    }

    if compare_versions(version, AGENT_VERSION) != Ordering::Greater {
        return Err(format!(
            "The agent runs {AGENT_VERSION}, so it won't install {version}, which isn't newer."
        ));
    }

    let asset = asset_name().ok_or_else(|| {
        format!(
            "There is no FleetFrog agent build for {} on {}.",
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;
    let executable = service::agent_executable()?;
    let directory = executable
        .parent()
        .ok_or_else(|| format!("{} has no folder.", executable.display()))?;
    let sums = download(version, "SHA256SUMS").await?;
    let checksum = listed_checksum(&String::from_utf8_lossy(&sums), asset)
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| format!("FleetFrog {version} lists no checksum for {asset}."))?;
    let binary = download(version, asset).await?;

    if sha256_hex(&binary) != checksum {
        return Err(format!(
            "The download of {asset} doesn't match the checksum FleetFrog {version} lists, so it wasn't installed."
        ));
    }

    let downloaded = Download::write(directory, &binary)?;
    let reported = run_tool(
        &downloaded.path.to_string_lossy(),
        &directory.to_string_lossy(),
        &["--version"],
    )
    .await
    .map_err(|error| format!("The downloaded agent doesn't run on this machine: {error}."))?;

    if reported.trim() != version {
        return Err(format!(
            "The downloaded agent reports version {}, not {version}, so it wasn't installed.",
            reported.trim()
        ));
    }

    downloaded.install(&executable)?;
    audit::write(AuditEntry::AgentUpdated {
        previous_version: AGENT_VERSION.into(),
        version: version.into(),
    });

    Ok(executable)
}

pub enum TargetError {
    Unreachable(String),
    /// The hub predates updates, so it can't name a version.
    HubTooOld,
    MachineRemoved,
    Failed(String),
}

/// The version the hub wants its agents to run: its own. Asked on a connection of its own, which
/// never sends `Connect`, so it works beside a running agent.
pub async fn target_version(config: &AgentConfig) -> Result<String, TargetError> {
    let client = HubClient::connect(config)
        .await
        .map_err(TargetError::Unreachable)?;
    let answer = client.call("TargetVersion", None).await;

    client.close().await;

    match answer {
        Ok(value) => value
            .get("version")
            .and_then(Value::as_str)
            .filter(|version| is_release_version(version))
            .map(String::from)
            .ok_or_else(|| {
                TargetError::Failed(format!(
                    "The hub answered without a release version: {value}"
                ))
            }),
        // Effect's RPC server answers a request it doesn't know with this defect.
        Err(RpcError::Defect(message)) if message.starts_with("Unknown request tag") => {
            Err(TargetError::HubTooOld)
        }
        Err(error) if error.is_tagged("Unauthorised") => Err(TargetError::MachineRemoved),
        Err(error) => Err(TargetError::Failed(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_versions_by_their_numbers() {
        assert_eq!(compare_versions("0.1.10", "0.2.0"), Ordering::Less);
        assert_eq!(compare_versions("0.10.0", "0.9.9"), Ordering::Greater);
        assert_eq!(compare_versions("1.2.3", "1.2.3"), Ordering::Equal);
        assert_eq!(compare_versions("1.2.3-beta.1", "1.2.3"), Ordering::Equal);
        assert_eq!(compare_versions("unknown", "0.0.1"), Ordering::Less);
    }

    #[test]
    fn accepts_only_release_numbers_as_versions_to_download() {
        assert!(is_release_version("0.2.0"));
        assert!(is_release_version("10.0.12"));
        assert!(!is_release_version(
            "9.9.9/../../../other/repo/releases/download/v1"
        ));
        assert!(!is_release_version("0.2.0-beta.1"));
        assert!(!is_release_version("0.2"));
        assert!(!is_release_version("0..2"));
    }

    #[test]
    fn finds_an_assets_checksum() {
        let sums = "e0fb  fleetfrog-linux-aarch64\nbe1a  fleetfrog-linux-x86_64\n28a3 *fleetfrog-macos-aarch64\n";

        assert_eq!(
            listed_checksum(sums, "fleetfrog-linux-x86_64"),
            Some("be1a")
        );
        assert_eq!(
            listed_checksum(sums, "fleetfrog-macos-aarch64"),
            Some("28a3")
        );
        assert_eq!(listed_checksum(sums, "fleetfrog-linux"), None);
    }
}
