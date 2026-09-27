//! Moving checkouts into the Archive folder and back.

use crate::discovery::archive_path;
use crate::git::CheckoutLocation;
use crate::paths;
use crate::process::GitError;
use crate::protocol::{
    ActionOutcome, ActionResult, MovedFolder, Placement, SkipReason, Worktree, failed, skipped,
    succeeded,
};
use crate::store::{self, ArchiveRecord, ArchivedWorktree};
use crate::time::Utc;

use super::Context;
use super::moves::{WhenTaken, movable_problem, perform_checkout_move, plan_checkout_move};

/// What the machine's configuration says about where checkouts live.
#[derive(Clone, Debug, Default)]
pub struct Folders {
    pub roots: Vec<String>,
    pub archive_folder: Option<String>,
}

fn record(original_path: &str, worktrees: &[MovedFolder], archived_at: Utc) -> ArchiveRecord {
    ArchiveRecord {
        original_path: original_path.to_string(),
        archived_at,
        worktrees: worktrees
            .iter()
            .map(|moved| ArchivedWorktree {
                original_path: moved.from.clone(),
                archived_path: moved.to.clone(),
            })
            .collect(),
    }
}

/// Moves a checkout into the Archive folder, at the same path below it as it had below its project
/// folder, and records where it came from. Its linked worktrees move too, each the same way, and
/// Git relinks them. A place something is already at gets a number added, as `-2` and so on.
pub async fn archive_checkout(
    location: &CheckoutLocation,
    folders: &Folders,
    home: &str,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let Some(archive) = archive_path(folders.archive_folder.as_deref(), &folders.roots) else {
        return Ok(skipped(SkipReason::NoArchiveFolder));
    };

    if let Some(problem) = movable_problem(location) {
        return Ok(problem);
    }

    let destination = paths::archive_destination(&location.path, &archive, home, &folders.roots);

    if paths::is_within(&destination, &location.path) {
        return Ok(failed("The Archive folder is inside this checkout."));
    }

    let planned = match plan_checkout_move(
        &location.path,
        &location.common_directory,
        &destination,
        |worktree| {
            Some(paths::archive_destination(
                worktree,
                &archive,
                home,
                &folders.roots,
            ))
        },
        WhenTaken::Number,
    )
    .await?
    {
        Ok(planned) => planned,
        Err(refused) => return Ok(refused),
    };
    let archived_at = Utc::now();

    if let Err(message) = store::write_archive_record(
        &location.common_directory,
        &record(&location.path, &planned.separate, archived_at),
    ) {
        return Ok(failed(message));
    }

    let moved = match perform_checkout_move(&planned, context).await {
        Ok(moved) => moved,
        Err(outcome) => {
            store::remove_archive_record(&location.common_directory);
            return Ok(outcome);
        }
    };
    let archived = planned.main.to.clone();

    // The record travelled with the checkout. It now lists only the worktrees that moved.
    let _ = store::write_archive_record(
        &paths::join(&archived, ".git"),
        &record(&location.path, &moved, archived_at),
    );

    Ok(succeeded(ActionResult::Archived {
        path: archived,
        worktrees: moved,
    }))
}

/// Moves an archived checkout back where it was archived from, or below the first project folder
/// when that place is no longer in one, with a number added when something is there now. The
/// worktrees archived alongside it go back likewise. Every worktree is relinked, including ones
/// that stay.
pub async fn unarchive_checkout(
    location: &CheckoutLocation,
    folders: &Folders,
    home: &str,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let Some(archive) = archive_path(folders.archive_folder.as_deref(), &folders.roots) else {
        return Ok(skipped(SkipReason::NoArchiveFolder));
    };

    // A linked worktree goes back with its main checkout, never on its own.
    if matches!(location.worktree, Worktree::Linked { .. }) {
        return Ok(skipped(SkipReason::IsWorktree));
    }

    let original_path = match &location.placement {
        Placement::Archive { original_path, .. } => original_path.as_deref(),
        Placement::Projects => None,
    };
    let Some(destination) = paths::unarchive_destination(
        &location.path,
        original_path,
        &archive,
        home,
        &folders.roots,
    ) else {
        return Ok(failed(
            "This machine has no project folders to move the checkout back into.",
        ));
    };
    // A worktree moved or removed since it was archived isn't at its archived path, so it stays.
    let returning: Vec<ArchivedWorktree> = store::read_archive_record(&location.common_directory)
        .map(|record| record.worktrees)
        .unwrap_or_default();
    let planned = match plan_checkout_move(
        &location.path,
        &location.common_directory,
        &destination,
        |worktree| {
            returning
                .iter()
                .find(|entry| entry.archived_path == worktree)
                .map(|entry| entry.original_path.clone())
        },
        WhenTaken::Number,
    )
    .await?
    {
        Ok(planned) => planned,
        Err(refused) => return Ok(refused),
    };
    let moved = match perform_checkout_move(&planned, context).await {
        Ok(moved) => moved,
        Err(outcome) => return Ok(outcome),
    };
    let unarchived = planned.main.to.clone();

    store::remove_archive_record(&paths::join(&unarchived, ".git"));

    Ok(succeeded(ActionResult::Unarchived {
        path: unarchived,
        worktrees: moved,
    }))
}
