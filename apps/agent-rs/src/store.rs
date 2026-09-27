//! Records kept beside checkouts: where an archived checkout came from, and what is in the trash.
//! Both are shared with the TypeScript agent. A record that fails to decode is skipped, so every
//! field added later needs a default.

use serde::{Deserialize, Serialize};

use crate::git::CheckoutLocation;
use crate::paths;
use crate::protocol::{Placement, TrashedCheckout, Worktree};
use crate::time::Utc;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedWorktree {
    pub original_path: String,
    pub archived_path: String,
}

/// Where FleetFrog moved an archived checkout from, kept in its Git directory so it travels with
/// the checkout and never shows up as a change.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveRecord {
    pub original_path: String,
    pub archived_at: Utc,
    /// The linked worktrees that moved with it. Absent from records that predate them.
    #[serde(default)]
    pub worktrees: Vec<ArchivedWorktree>,
}

fn record_path(common_directory: &str) -> String {
    paths::join(common_directory, "fleetfrog-archive.json")
}

/// Saves the record, returning why it couldn't be saved.
pub fn write_archive_record(common_directory: &str, record: &ArchiveRecord) -> Result<(), String> {
    let json = serde_json::to_string(record).expect("archive records encode as JSON");

    std::fs::write(record_path(common_directory), format!("{json}\n"))
        .map_err(|error| format!("Couldn't record where the checkout came from: Error: {error}"))
}

/// Removes the record if there is one. A checkout without one is simply not archived.
pub fn remove_archive_record(common_directory: &str) {
    let _ = std::fs::remove_file(record_path(common_directory));
}

/// The checkout's record, or None for one put in the archive by hand.
pub fn read_archive_record(common_directory: &str) -> Option<ArchiveRecord> {
    serde_json::from_str(&std::fs::read_to_string(record_path(common_directory)).ok()?).ok()
}

/// How an archived checkout came to be there, from its clone's record. A linked worktree has its
/// own original path in the record. One put in the archive by hand has no record.
pub fn archived_placement(location: &CheckoutLocation) -> Placement {
    match read_archive_record(&location.common_directory) {
        None => Placement::Archive {
            original_path: None,
            archived_at: None,
        },
        Some(record) => Placement::Archive {
            original_path: match location.worktree {
                Worktree::Main => Some(record.original_path),
                Worktree::Linked { .. } => record
                    .worktrees
                    .into_iter()
                    .find(|worktree| worktree.archived_path == location.path)
                    .map(|worktree| worktree.original_path),
            },
            archived_at: Some(record.archived_at),
        },
    }
}

/// Where this machine keeps trashed checkouts: application data in the home directory, which is
/// normally on the same disk as the projects, so moving a checkout there is a rename.
pub fn default_trash_directory() -> String {
    if cfg!(target_os = "macos") {
        paths::join(
            &paths::home(),
            "Library/Application Support/FleetFrog/Trash",
        )
    } else {
        paths::join(
            &paths::env("XDG_DATA_HOME")
                .unwrap_or_else(|| paths::join(&paths::home(), ".local/share")),
            "fleetfrog/trash",
        )
    }
}

/// The folder holding one trashed checkout: its record, the checkout itself, and any linked
/// worktrees trashed with it.
fn item_directory(trash: &str, id: &str) -> String {
    paths::join(trash, id)
}

pub fn item_checkout_path(trash: &str, id: &str) -> String {
    paths::join(&item_directory(trash, id), "checkout")
}

pub fn item_worktree_path(trash: &str, id: &str, name: &str) -> String {
    paths::join(&paths::join(&item_directory(trash, id), "worktrees"), name)
}

fn item_record_path(trash: &str, id: &str) -> String {
    paths::join(&item_directory(trash, id), "item.json")
}

/// Creates the item's folder and saves its record, returning why that failed.
pub fn write_trash_item(trash: &str, item: &TrashedCheckout) -> Result<(), String> {
    use std::os::unix::fs::DirBuilderExt;

    let json = serde_json::to_string(item).expect("trash items encode as JSON");

    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(item_directory(trash, &item.id))
        .and_then(|()| std::fs::write(item_record_path(trash, &item.id), format!("{json}\n")))
        .map_err(|error| format!("Couldn't prepare the trash: Error: {error}"))
}

/// The item's record, or None when it isn't in the trash.
pub fn read_trash_item(trash: &str, id: &str) -> Option<TrashedCheckout> {
    serde_json::from_str(&std::fs::read_to_string(item_record_path(trash, id)).ok()?).ok()
}

/// Removes the item's folder and everything in it.
pub async fn remove_trash_item(trash: &str, id: &str) -> Result<(), String> {
    remove_tree(item_directory(trash, id))
        .await
        .map_err(|error| format!("Couldn't remove it from the trash: Error: {error}"))
}

/// Removes the item's record and whatever folders are left empty after a restore. Anything still
/// in them, such as a worktree that couldn't move back, stays in place.
pub fn forget_trash_item(trash: &str, id: &str) {
    let _ = std::fs::remove_file(item_record_path(trash, id));
    let _ = std::fs::remove_dir(paths::join(&item_directory(trash, id), "worktrees"));
    let _ = std::fs::remove_dir(item_directory(trash, id));
}

/// Everything in the trash, newest first. Folders without a readable record are left out.
pub fn list_trash(trash: &str) -> Vec<TrashedCheckout> {
    let mut items: Vec<TrashedCheckout> = std::fs::read_dir(trash)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let record = paths::join(
                        &paths::join(trash, &entry.file_name().to_string_lossy()),
                        "item.json",
                    );

                    serde_json::from_str(&std::fs::read_to_string(record).ok()?).ok()
                })
                .collect()
        })
        .unwrap_or_default();

    items.sort_by_key(|item| std::cmp::Reverse(item.trashed_at));
    items
}

/// Deletes a file or folder with everything in it, as `rm -rf` does, without following symbolic
/// links. A path that is already gone counts as removed.
pub async fn remove_tree(path: String) -> std::io::Result<()> {
    tokio::task::spawn_blocking(move || {
        let result = match std::fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
            Ok(found) if found.is_dir() => std::fs::remove_dir_all(&path),
            Ok(_) => std::fs::remove_file(&path),
        };

        match result {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    })
    .await
    .unwrap_or_else(|error| Err(std::io::Error::other(error)))
}
