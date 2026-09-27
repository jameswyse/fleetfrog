//! Finding the checkouts under the discovery roots, the other project folders and the Archive
//! folder.

use std::collections::HashSet;

use futures_util::StreamExt;
use futures_util::stream;

use crate::git::{self, CheckoutLocation};
use crate::paths;
use crate::protocol::Placement;
use crate::store;

const MAXIMUM_DEPTH: usize = 5;
const SKIPPED_DIRECTORIES: [&str; 1] = ["node_modules"];
const GIT_CONCURRENCY: usize = 8;

/// A discovery folder as a path on this machine.
pub fn root_path(root: &str) -> String {
    paths::expand_home(root, &paths::home())
}

/// Directories under `root` that contain a `.git` entry, without descending into repositories or
/// into `skipped`, such as an Archive folder inside a project folder.
fn find_repository_directories(root: &str, skipped: Option<&str>) -> Vec<String> {
    let mut found = Vec::new();
    let mut pending = vec![(root.to_string(), 0)];

    while let Some((directory, depth)) = pending.pop() {
        // Missing roots and unreadable directories contribute nothing.
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        let entries: Vec<_> = entries.flatten().collect();

        if entries.iter().any(|entry| entry.file_name() == ".git") {
            found.push(directory);
            continue;
        }

        if depth == MAXIMUM_DEPTH {
            continue;
        }

        for entry in entries {
            let name = entry.file_name().to_string_lossy().into_owned();
            let child = paths::join(&directory, &name);
            // Symbolic links are skipped so a link back up the tree cannot loop.
            let is_directory = entry.file_type().is_ok_and(|kind| kind.is_dir());

            if is_directory
                && !name.starts_with('.')
                && !SKIPPED_DIRECTORIES.contains(&name.as_str())
                && Some(child.as_str()) != skipped
            {
                pending.push((child, depth + 1));
            }
        }
    }

    found
}

async fn find_in_background(root: String, skipped: Option<String>) -> Vec<String> {
    tokio::task::spawn_blocking(move || find_repository_directories(&root, skipped.as_deref()))
        .await
        .unwrap_or_default()
}

/// Linked worktrees of the repository at `directory`, wherever they live.
async fn linked_worktree_paths(directory: &str) -> Vec<String> {
    // Bare and prunable entries have no usable working tree.
    git::list_worktrees(directory)
        .await
        .map(|records| {
            records
                .into_iter()
                .filter(|record| !record.bare && !record.prunable)
                .map(|record| record.path)
                .collect()
        })
        .unwrap_or_default()
}

/// The Archive folder as a path on this machine, or None when none is set or it can't be one here
/// because it holds a project folder.
pub fn archive_path(archive_folder: Option<&str>, roots: &[String]) -> Option<String> {
    match paths::check_archive_folder(archive_folder?, &paths::home(), roots) {
        paths::ArchiveFolderCheck::Valid(path) => Some(path),
        _ => None,
    }
}

/// The location with its placement: archived when it's inside the Archive folder.
pub fn place_location(mut location: CheckoutLocation, archive: Option<&str>) -> CheckoutLocation {
    if archive.is_some_and(|archive| paths::is_within(&location.path, archive)) {
        location.placement = store::archived_placement(&location);
    } else {
        location.placement = Placement::Projects;
    }

    location
}

/// Finds every checkout under the discovery roots and at the other project folders, plus linked
/// worktrees stored elsewhere, and every checkout in the Archive folder. The Archive folder is left
/// out of the discovery roots it's in.
pub async fn discover_checkouts(
    roots: &[String],
    archive_folder: Option<&str>,
    project_folders: &[String],
) -> Vec<CheckoutLocation> {
    let archive = archive_path(archive_folder, roots);
    let mut directories = Vec::new();

    for root in roots {
        directories.extend(find_in_background(root_path(root), archive.clone()).await);
    }

    directories.extend(project_folders.iter().cloned());

    let archived = match &archive {
        None => Vec::new(),
        Some(archive) => find_in_background(archive.clone(), None).await,
    };
    let worktrees: Vec<Vec<String>> = stream::iter(directories.clone())
        .map(|directory| async move { linked_worktree_paths(&directory).await })
        .buffered(GIT_CONCURRENCY)
        .collect()
        .await;
    let mut seen = HashSet::new();
    let candidates: Vec<String> = directories
        .iter()
        .cloned()
        .chain(worktrees.into_iter().flatten())
        .chain(archived)
        .filter(|candidate| seen.insert(candidate.clone()))
        .collect();
    let located: Vec<Option<CheckoutLocation>> = stream::iter(candidates)
        .map(|candidate| {
            let archive = archive.clone();

            async move {
                git::locate_checkout(&candidate)
                    .await
                    .map(|location| place_location(location, archive.as_deref()))
            }
        })
        .buffered(GIT_CONCURRENCY)
        .collect()
        .await;
    let mut by_path: Vec<CheckoutLocation> = Vec::new();

    for location in located.into_iter().flatten() {
        match by_path.iter_mut().find(|known| known.path == location.path) {
            Some(known) => *known = location,
            None => by_path.push(location),
        }
    }

    by_path
}
