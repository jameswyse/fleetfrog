use crate::audit::{self, AuditEntry};
use crate::config::load_policy;
use crate::paths::{self, FolderPathCheck};
use crate::protocol::{FolderOutcome, Tier};

fn failed(message: impl Into<String>) -> FolderOutcome {
    FolderOutcome::Failed {
        message: message.into(),
    }
}

/// Creates one of this machine's project folders, or its Archive folder, when the hub asks, with
/// any missing parents. The path must be one the hub has set, and neither hidden nor reached
/// through `.` or `..`. A project folder belongs to the git tier, which covers the folders clones
/// go into, and the Archive folder to the cleanup tier, so an owner who has turned the tier off
/// gets nothing created. Only a folder actually made is audited.
pub fn create_project_folder(
    path: &str,
    roots: &[String],
    archive_folder: Option<&str>,
    home: &str,
) -> FolderOutcome {
    let (tier, turned_off) = if roots.iter().any(|root| root == path) {
        (
            Tier::Git,
            "Git actions are turned off on this machine, and they include creating project folders.",
        )
    } else if archive_folder == Some(path) {
        (
            Tier::Cleanup,
            "Cleanup actions are turned off on this machine, and they include creating the Archive folder.",
        )
    } else {
        return failed(format!(
            "{path} isn't one of this machine's project folders or its Archive folder."
        ));
    };

    if !load_policy().is_ok_and(|policy| policy.allows(tier)) {
        return failed(turned_off);
    }

    let folder = match paths::check_folder_path(path, home) {
        FolderPathCheck::Valid(folder) => folder,
        FolderPathCheck::NotAbsolute => return failed("It isn't a full path."),
        FolderPathCheck::Hidden => {
            return failed("It's a hidden folder, or its path has . or .. segments.");
        }
    };

    if let Ok(existing) = std::fs::metadata(&folder) {
        return if existing.is_dir() {
            FolderOutcome::AlreadyThere
        } else {
            failed(format!(
                "Something other than a folder is already at {folder}."
            ))
        };
    }

    match std::fs::create_dir_all(&folder) {
        Ok(()) => {
            audit::write(AuditEntry::FolderCreated { path: folder });
            FolderOutcome::Created
        }
        Err(error) => failed(format!("Couldn't create {folder}: {error}")),
    }
}
