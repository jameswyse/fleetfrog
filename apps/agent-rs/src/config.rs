//! What pairing leaves behind, and the owner's policy. Both files are shared with the TypeScript
//! agent, so either can run on a machine the other paired.

use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};

use serde::{Deserialize, Serialize};

use crate::audit::{self, AuditEntry};
use crate::instance;
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
            &instance::named("fleetfrog"),
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

/// Which tiers of actions the machine's owner allows, with every tier this agent knows decided. It
/// lives in its own file so that pairing again keeps it, and only a command run on this machine
/// changes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentPolicy {
    pub allowed_tiers: Vec<Tier>,
}

impl AgentPolicy {
    pub fn allows(&self, tier: Tier) -> bool {
        self.allowed_tiers.contains(&tier)
    }
}

/// The policy file. It lists denied tiers as well as allowed ones, so a tier in neither is one
/// the owner hasn't decided, such as one added after the file was written. Tiers this agent
/// doesn't know, from a newer agent, are left out rather than making the file unreadable.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyFile {
    allowed_tiers: Vec<String>,
    /// Absent from files written before it, when `git` and `cleanup` were the only tiers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    denied_tiers: Option<Vec<String>>,
}

/// The tiers that existed before the policy listed denied tiers. A file without that list denied
/// each of these it didn't allow.
const TIERS_BEFORE_DENIED_LIST: [Tier; 2] = [Tier::Git, Tier::Cleanup];

/// What the policy file says, with each undecided tier given its default.
struct ReadPolicy {
    policy: AgentPolicy,
    /// Tiers that took their default because the file didn't decide them.
    defaulted: Vec<Tier>,
    /// Whether the file needs writing to record every decision: it's missing, predates the
    /// denied list or leaves a tier undecided.
    incomplete: bool,
}

fn known_tiers(names: &[String]) -> Vec<Tier> {
    names.iter().filter_map(|name| Tier::parse(name)).collect()
}

/// Decides every tier from the file, or from defaults when there is none. A denial wins over an
/// allowance of the same tier.
fn decide(file: Option<&PolicyFile>) -> ReadPolicy {
    let allowed = file
        .map(|file| known_tiers(&file.allowed_tiers))
        .unwrap_or_default();
    let denied = match file {
        None => Vec::new(),
        Some(PolicyFile {
            denied_tiers: Some(names),
            ..
        }) => known_tiers(names),
        Some(PolicyFile {
            denied_tiers: None, ..
        }) => TIERS_BEFORE_DENIED_LIST
            .into_iter()
            .filter(|tier| !allowed.contains(tier))
            .collect(),
    };
    let mut allowed_tiers = Vec::new();
    let mut defaulted = Vec::new();

    for tier in Tier::ALL {
        let decided = allowed.contains(&tier) || denied.contains(&tier);

        if !decided {
            defaulted.push(tier);
        }

        if !denied.contains(&tier)
            && (allowed.contains(&tier) || (!decided && tier.allowed_by_default()))
        {
            allowed_tiers.push(tier);
        }
    }

    ReadPolicy {
        incomplete: !defaulted.is_empty() || file.is_none_or(|file| file.denied_tiers.is_none()),
        policy: AgentPolicy { allowed_tiers },
        defaulted,
    }
}

fn read_policy() -> Result<ReadPolicy, ConfigUnavailable> {
    let file = policy_path();
    let Some(text) = read_optional(&file)? else {
        return Ok(decide(None));
    };
    let stored: PolicyFile = serde_json::from_str(&text).map_err(|_| ConfigUnavailable {
        path: file,
        message: "The saved policy is not valid.".into(),
    })?;

    Ok(decide(Some(&stored)))
}

/// The saved policy, with each tier it doesn't decide at its default. A damaged file fails rather
/// than guessing.
pub fn load_policy() -> Result<AgentPolicy, ConfigUnavailable> {
    read_policy().map(|read| read.policy)
}

fn save_policy(policy: &AgentPolicy) -> Result<(), ConfigUnavailable> {
    let file = policy_path();
    let unavailable = |error: std::io::Error| ConfigUnavailable {
        path: file.clone(),
        message: describe_io(&error),
    };
    let staged = format!("{file}.{}.tmp", std::process::id());
    let names = |allowed: bool| {
        Tier::ALL
            .into_iter()
            .filter(|tier| policy.allows(*tier) == allowed)
            .map(|tier| tier.as_str().to_string())
            .collect()
    };
    let json = serde_json::to_string(&PolicyFile {
        allowed_tiers: names(true),
        denied_tiers: Some(names(false)),
    })
    .expect("the policy encodes as JSON");

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

/// Records in the audit log the tiers that took their default in `policy`.
fn audit_defaults(defaulted: &[Tier], policy: &AgentPolicy) {
    if defaulted.is_empty() {
        return;
    }

    let (allowed_tiers, denied_tiers) = defaulted
        .iter()
        .partition::<Vec<Tier>, _>(|tier| policy.allows(**tier));

    audit::write(AuditEntry::PolicyDefaultsApplied {
        allowed_tiers,
        denied_tiers,
    });
}

/// Writes each tier the policy doesn't decide into it at its default, so a later change to that
/// default leaves this machine as it is. Returns the tiers that took their default.
pub fn record_policy_defaults() -> Result<Vec<Tier>, ConfigUnavailable> {
    let read = read_policy()?;

    if read.incomplete {
        save_policy(&read.policy)?;
        audit_defaults(&read.defaulted, &read.policy);
    }

    Ok(read.defaulted)
}

pub struct PolicyChange {
    pub changed: bool,
    pub replaced_damaged: bool,
}

/// Allows and denies tiers, then saves and records the policy only if that changed it. A damaged
/// policy allows nothing, so the change starts from nothing and replaces it.
pub fn change_policy(allow: &[Tier], deny: &[Tier]) -> Result<PolicyChange, ConfigUnavailable> {
    let current = read_policy().ok();
    let replaced_damaged = current.is_none();
    let (policy, defaulted, incomplete) = match current {
        Some(read) => (read.policy, read.defaulted, read.incomplete),
        None => (
            AgentPolicy {
                allowed_tiers: Vec::new(),
            },
            Vec::new(),
            true,
        ),
    };
    let allowed_tiers: Vec<Tier> = Tier::ALL
        .into_iter()
        .filter(|tier| !deny.contains(tier) && (policy.allows(*tier) || allow.contains(tier)))
        .collect();
    let changed = replaced_damaged || allowed_tiers != policy.allowed_tiers;

    // Saving also records any defaults the file didn't have yet.
    if changed || incomplete {
        let saved = AgentPolicy {
            allowed_tiers: allowed_tiers.clone(),
        };
        let untouched: Vec<Tier> = defaulted
            .into_iter()
            .filter(|tier| !allow.contains(tier) && !deny.contains(tier))
            .collect();

        save_policy(&saved)?;
        audit_defaults(&untouched, &saved);
    }

    if changed {
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

    fn read(json: &str) -> ReadPolicy {
        decide(Some(&serde_json::from_str::<PolicyFile>(json).unwrap()))
    }

    #[test]
    fn keeps_denials_from_files_written_before_the_denied_list() {
        let read = read(r#"{"allowedTiers":["git"]}"#);

        assert_eq!(read.policy.allowed_tiers, vec![Tier::Git, Tier::Update]);
        assert_eq!(read.defaulted, vec![Tier::Update]);
        assert!(read.incomplete);
    }

    #[test]
    fn follows_a_complete_file_and_skips_tiers_it_does_not_know() {
        let read = read(
            r#"{"allowedTiers":["git","teleport"],"deniedTiers":["cleanup","update","teleport"]}"#,
        );

        assert_eq!(read.policy.allowed_tiers, vec![Tier::Git]);
        assert!(read.defaulted.is_empty());
        assert!(!read.incomplete);
    }

    #[test]
    fn gives_undecided_tiers_their_defaults() {
        let read = read(r#"{"allowedTiers":[],"deniedTiers":["git"]}"#);

        assert_eq!(read.policy.allowed_tiers, vec![Tier::Cleanup, Tier::Update]);
        assert_eq!(read.defaulted, vec![Tier::Cleanup, Tier::Update]);
        assert!(read.incomplete);

        let missing = decide(None);

        assert_eq!(missing.policy.allowed_tiers, Tier::ALL.to_vec());
        assert!(missing.incomplete);
    }

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
