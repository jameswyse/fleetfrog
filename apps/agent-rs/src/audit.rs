//! Something this machine did or allowed, recorded locally where the hub cannot change it. Only
//! requested actions and changes are recorded, never scans or connections.

use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};

use serde::Serialize;

use crate::git::remote::without_credentials;
use crate::instance;
use crate::paths;
use crate::protocol::{ActionOutcome, ActionRequest, Tier};
use crate::time::Utc;

#[derive(Serialize, Debug)]
#[serde(tag = "event", rename_all_fields = "camelCase")]
pub enum AuditEntry {
    ActionStarted {
        run_id: String,
        request: ActionRequest,
    },
    ActionFinished {
        run_id: String,
        outcome: ActionOutcome,
    },
    /// The agent stopped before it could report, usually because the hub connection dropped.
    ActionInterrupted {
        run_id: String,
    },
    /// Refused before it could change anything: not allowed, or not something this agent knows.
    ActionRefused {
        run_id: String,
        request: ActionRequest,
        reason: String,
    },
    /// A project folder the hub asked for, created because it was missing.
    FolderCreated {
        path: String,
    },
    PolicyChanged {
        allowed_tiers: Vec<Tier>,
    },
    Paired {
        agent_url: String,
        machine_id: String,
    },
    /// The agent replaced its binary with another release, from `fleetfrog update` or for the hub.
    /// Only the Rust agent updates itself, so the TypeScript agent never writes this event.
    AgentUpdated {
        previous_version: String,
        version: String,
    },
}

/// At this size the log moves to `actions.log.1`, replacing the previous one.
const ROTATE_AT_BYTES: u64 = 1024 * 1024;

pub fn audit_log_path() -> String {
    let directory = if cfg!(target_os = "macos") {
        paths::join(
            &paths::home(),
            &format!("Library/Logs/{}", instance::named("FleetFrog")),
        )
    } else {
        paths::join(
            &paths::env("XDG_STATE_HOME")
                .unwrap_or_else(|| paths::join(&paths::home(), ".local/state")),
            &instance::named("fleetfrog"),
        )
    };

    paths::join(&directory, "actions.log")
}

/// The hub is expected to send clean URLs, but the log is written before the agent checks them.
fn loggable(entry: AuditEntry) -> AuditEntry {
    let clean = |request: ActionRequest| match request {
        ActionRequest::Clone { url, destination } => ActionRequest::Clone {
            url: without_credentials(&url),
            destination,
        },
        other => other,
    };

    match entry {
        AuditEntry::ActionStarted { run_id, request } => AuditEntry::ActionStarted {
            run_id,
            request: clean(request),
        },
        AuditEntry::ActionRefused {
            run_id,
            request,
            reason,
        } => AuditEntry::ActionRefused {
            run_id,
            request: clean(request),
            reason,
        },
        other => other,
    }
}

fn append(file: &str, line: &str) -> std::io::Result<()> {
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(paths::dirname(file))?;

    if std::fs::metadata(file)
        .map(|found| found.len())
        .unwrap_or(0)
        >= ROTATE_AT_BYTES
    {
        std::fs::rename(file, format!("{file}.1"))?;
    }

    std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .mode(0o600)
        .open(file)?
        .write_all(line.as_bytes())
}

/// Appends one JSON line. A log that cannot be written is reported but never stops an action.
pub fn write(entry: AuditEntry) {
    let file = audit_log_path();
    let body = serde_json::to_string(&loggable(entry)).expect("audit entries encode as JSON");
    let line = format!("{{\"at\":\"{}\",{}\n", Utc::now().format_iso(), &body[1..]);

    if let Err(error) = append(&file, &line) {
        crate::log::warning(&format!("Could not write the audit log at {file}"), error);
    }
}
