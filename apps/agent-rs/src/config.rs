//! What pairing leaves behind, and the owner's policy. Both files are shared with the TypeScript
//! agent, so either can run on a machine the other paired.

use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};

use serde::{Deserialize, Serialize};

use crate::audit::{self, AuditEntry};
use crate::paths;
use crate::protocol::Tier;

/// Where the hub is, how to recognise it and how to prove who we are.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub agent_url: String,
    pub machine_id: String,
    pub token: String,
    /// The hub's pinned self-signed certificate, absent when the hub uses a publicly trusted one.
    pub certificate_pem: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ConfigUnavailable {
    pub path: String,
    pub message: String,
}

pub fn config_directory() -> String {
    paths::env("FLEETFROG_CONFIG_DIR").unwrap_or_else(|| {
        paths::join(
            &paths::env("XDG_CONFIG_HOME")
                .unwrap_or_else(|| paths::join(&paths::home(), ".config")),
            "fleetfrog",
        )
    })
}

pub fn config_path() -> String {
    paths::join(&config_directory(), "agent.json")
}

pub fn policy_path() -> String {
    paths::join(&config_directory(), "policy.json")
}

/// Node's description of a file system error, such as `Error: ENOENT: no such file or directory`.
pub fn describe_io(error: &std::io::Error) -> String {
    format!("Error: {error}")
}

/// Whether the text is a UUID as Effect's `Schema.isUUID` accepts one: any version from 1 to 8
/// with the RFC 9562 variant, or the nil or max UUID.
pub fn is_uuid(text: &str) -> bool {
    let bytes = text.as_bytes();
    let shaped = bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        });
    let special = text == "00000000-0000-0000-0000-000000000000"
        || text.eq_ignore_ascii_case("ffffffff-ffff-ffff-ffff-ffffffffffff");

    shaped
        && (special
            || (matches!(bytes[14], b'1'..=b'8')
                && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')))
}

/// Reads a file, or None when it doesn't exist. Any other read error is reported.
fn read_optional(file: &str) -> Result<Option<String>, ConfigUnavailable> {
    match std::fs::read_to_string(file) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ConfigUnavailable {
            path: file.to_string(),
            message: describe_io(&error),
        }),
    }
}

/// The saved pairing, or None before the machine is paired.
pub fn load_agent_config() -> Result<Option<AgentConfig>, ConfigUnavailable> {
    let file = config_path();
    let Some(text) = read_optional(&file)? else {
        return Ok(None);
    };

    serde_json::from_str::<AgentConfig>(&text)
        .ok()
        .filter(|config| is_uuid(&config.machine_id))
        .map(Some)
        .ok_or(ConfigUnavailable {
            path: file,
            message: "The saved pairing is not valid.".into(),
        })
}

fn create_private_directory(directory: &str) -> std::io::Result<()> {
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(directory)
}

/// Creates the config directory and checks it can be written, before anything depends on it.
pub fn ensure_config_writable() -> Result<(), ConfigUnavailable> {
    let directory = config_directory();
    let unavailable = |error: std::io::Error| ConfigUnavailable {
        path: directory.clone(),
        message: describe_io(&error),
    };

    create_private_directory(&directory).map_err(unavailable)?;

    let path = std::ffi::CString::new(directory.as_str()).unwrap_or_default();

    // SAFETY: `access` only reads the NUL-terminated path.
    if unsafe { libc::access(path.as_ptr(), libc::W_OK) } != 0 {
        return Err(unavailable(std::io::Error::last_os_error()));
    }

    Ok(())
}

/// Saves the pairing readable only by the current user, since it holds the agent's token.
pub fn save_agent_config(config: &AgentConfig) -> Result<(), ConfigUnavailable> {
    let directory = config_directory();
    let file = config_path();
    let unavailable = |error: std::io::Error| ConfigUnavailable {
        path: file.clone(),
        message: describe_io(&error),
    };
    let json = serde_json::to_string(config).expect("the pairing encodes as JSON");

    create_private_directory(&directory).map_err(unavailable)?;
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&file)
        .and_then(|mut handle| handle.write_all(format!("{json}\n").as_bytes()))
        .map_err(unavailable)?;
    // Creation modes do not apply to a directory or file that already exists.
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
        .map_err(unavailable)?;
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).map_err(unavailable)
}

/// Which tiers of actions the machine's owner allows. It lives in its own file so that pairing
/// again keeps it, and only a command run on this machine changes it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPolicy {
    pub allowed_tiers: Vec<Tier>,
}

impl AgentPolicy {
    /// Every tier is allowed until the owner denies it.
    pub fn default_policy() -> AgentPolicy {
        AgentPolicy {
            allowed_tiers: Tier::ALL.to_vec(),
        }
    }

    pub fn allows(&self, tier: Tier) -> bool {
        self.allowed_tiers.contains(&tier)
    }
}

/// The saved policy, or the default when there is none. A damaged file fails rather than guessing.
pub fn load_policy() -> Result<AgentPolicy, ConfigUnavailable> {
    let file = policy_path();
    let Some(text) = read_optional(&file)? else {
        return Ok(AgentPolicy::default_policy());
    };

    serde_json::from_str(&text).map_err(|_| ConfigUnavailable {
        path: file,
        message: "The saved policy is not valid.".into(),
    })
}

fn save_policy(policy: &AgentPolicy) -> Result<(), ConfigUnavailable> {
    let file = policy_path();
    let unavailable = |error: std::io::Error| ConfigUnavailable {
        path: file.clone(),
        message: describe_io(&error),
    };
    let staged = format!("{file}.{}.tmp", std::process::id());
    let json = serde_json::to_string(policy).expect("the policy encodes as JSON");

    create_private_directory(&config_directory()).map_err(unavailable)?;
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&staged)
        .and_then(|mut handle| handle.write_all(format!("{json}\n").as_bytes()))
        .map_err(unavailable)?;
    // Only the owner may widen what the hub can ask for.
    std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o600))
        .map_err(unavailable)?;
    // The running agent reads the policy at any moment, so it must never see half a file.
    std::fs::rename(&staged, &file).map_err(unavailable)
}

pub struct PolicyChange {
    pub changed: bool,
    pub replaced_damaged: bool,
}

/// Allows and denies tiers, then saves and records the policy only if that changed it. A damaged
/// policy allows nothing, so the change starts from nothing and replaces it.
pub fn change_policy(allow: &[Tier], deny: &[Tier]) -> Result<PolicyChange, ConfigUnavailable> {
    let current = load_policy().ok();
    let replaced_damaged = current.is_none();
    let policy = current.unwrap_or(AgentPolicy {
        allowed_tiers: Vec::new(),
    });
    let mut allowed_tiers = Vec::new();

    for tier in policy.allowed_tiers.iter().chain(allow) {
        if !allowed_tiers.contains(tier) && !deny.contains(tier) {
            allowed_tiers.push(*tier);
        }
    }

    let changed = replaced_damaged
        || allowed_tiers.len() != policy.allowed_tiers.len()
        || allowed_tiers
            .iter()
            .any(|tier| !policy.allowed_tiers.contains(tier));

    if changed {
        save_policy(&AgentPolicy {
            allowed_tiers: allowed_tiers.clone(),
        })?;
        audit::write(AuditEntry::PolicyChanged { allowed_tiers });
    }

    Ok(PolicyChange {
        changed,
        replaced_damaged,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_uuids() {
        assert!(is_uuid("0f8fad5b-d9cb-469f-a165-70867728950e"));
        assert!(!is_uuid("0f8fad5b-d9cb-469f-a165-70867728950"));
        assert!(!is_uuid("0f8fad5bxd9cb-469f-a165-70867728950e"));
        assert!(!is_uuid("0f8fad5b-d9cb-069f-a165-70867728950e"));
        assert!(!is_uuid("0f8fad5b-d9cb-469f-c165-70867728950e"));
        assert!(is_uuid("00000000-0000-0000-0000-000000000000"));
    }
}
