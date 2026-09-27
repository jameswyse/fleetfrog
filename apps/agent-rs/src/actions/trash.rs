//! The checkout trash, and deleting checkouts for good.

use ring::rand::SecureRandom;

use crate::git::{self, CheckoutLocation};
use crate::inspect::{Fetch, fingerprint_checkout, inspect_checkout, read_ignored};
use crate::paths;
use crate::process::{GitAction, GitError, disk_usage, run_git_action};
use crate::protocol::{
    ActionOutcome, ActionResult, Head, SkipReason, TrashedCheckout, TrashedWorktree, WorktreeState,
    failed, skipped, succeeded,
};
use crate::store;
use crate::time::Utc;

use super::Context;
use super::moves::{
    WhenTaken, movable_problem, perform_checkout_move, plan_checkout_move, worktrees_problem,
};

/// A random version 4 UUID, as `crypto.randomUUID` makes.
pub fn random_uuid() -> String {
    let mut bytes = [0u8; 16];

    ring::rand::SystemRandom::new()
        .fill(&mut bytes)
        .expect("the system has randomness");
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();

    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

/// What a folder takes up on disk.
async fn size_of(folder: &str) -> u64 {
    disk_usage(&paths::dirname(folder), &[paths::basename(folder)])
        .await
        .first()
        .copied()
        .unwrap_or(0)
}

/// Deletes cache folders inside `folder`, returning the bytes they took up and any that couldn't
/// be deleted. A symbolic link is removed itself, never what it points at.
async fn remove_caches(folder: &str, caches: &[String]) -> (u64, Vec<String>) {
    let inside: Vec<String> = caches
        .iter()
        .filter(|entry| paths::is_within(&paths::resolve(folder, entry), folder))
        .cloned()
        .collect();
    let sizes = disk_usage(folder, &inside).await;
    let mut freed = 0;
    let mut problems = Vec::new();

    for (index, entry) in inside.iter().enumerate() {
        match store::remove_tree(paths::resolve(folder, entry)).await {
            Ok(()) => freed += sizes.get(index).copied().unwrap_or(0),
            Err(error) => problems.push(format!("{entry}: Error: {error}")),
        }
    }

    (freed, problems)
}

fn trashed_worktrees(moved: &[crate::protocol::MovedFolder]) -> Vec<TrashedWorktree> {
    moved
        .iter()
        .map(|moved| TrashedWorktree {
            original_path: moved.from.clone(),
            trashed_path: moved.to.clone(),
        })
        .collect()
}

/// Moves a checkout into the machine's trash, with its linked worktrees and a record of where they
/// came from, if it still matches the inspection the dashboard showed. Caches are deleted from the
/// trashed copy when asked, so a move that fails leaves everything where it was.
pub async fn trash_checkout(
    location: &CheckoutLocation,
    fingerprint: &str,
    remove_cache_folders: bool,
    trash: &str,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    if let Some(problem) = movable_problem(location) {
        return Ok(problem);
    }

    let ignored = read_ignored(&location.path).await?;

    if fingerprint_checkout(location, &ignored).await? != fingerprint {
        return Ok(skipped(SkipReason::ChangedSinceInspection));
    }

    let status = git::read_git_status(location).await?;
    let id = random_uuid();
    let mut count = 0;
    let planned = match plan_checkout_move(
        &location.path,
        &location.common_directory,
        &store::item_checkout_path(trash, &id),
        |worktree| {
            count += 1;
            Some(store::item_worktree_path(
                trash,
                &id,
                &format!("{count}-{}", paths::basename(worktree)),
            ))
        },
        WhenTaken::Refuse,
    )
    .await?
    {
        Ok(planned) => planned,
        Err(refused) => return Ok(refused),
    };
    let item = TrashedCheckout {
        id: id.clone(),
        original_path: location.path.clone(),
        identity: location.identity.clone(),
        directory_name: location.directory_name.clone(),
        branch: match status.head {
            Head::Detached => None,
            head => head.name().map(String::from),
        },
        last_commit: status.last_commit,
        trashed_at: Utc::now(),
        size_bytes: size_of(&location.path).await,
        worktrees: trashed_worktrees(&planned.separate),
    };

    if let Err(message) = store::write_trash_item(trash, &item) {
        return Ok(failed(message));
    }

    let moved = match perform_checkout_move(&planned, context).await {
        Ok(moved) => moved,
        Err(outcome) => {
            let _ = store::remove_trash_item(trash, &id).await;
            return Ok(outcome);
        }
    };
    let trashed = &planned.main.to;
    let (freed_bytes, problems) = if remove_cache_folders && !ignored.caches.is_empty() {
        remove_caches(trashed, &ignored.caches).await
    } else {
        (0, Vec::new())
    };

    for line in problems {
        context
            .output
            .write(&format!("Couldn't delete a cache folder, {line}\n"));
    }

    // The record is already saved, so a failure here only leaves it out of date.
    let _ = store::write_trash_item(
        trash,
        &TrashedCheckout {
            size_bytes: size_of(trashed).await,
            worktrees: trashed_worktrees(&moved),
            ..item
        },
    );

    Ok(succeeded(ActionResult::Trashed { freed_bytes }))
}

/// Deletes a checkout for good, only if it still matches the inspection the dashboard showed.
/// Unless the developer accepted losing its unique work with `discard_unique_work`, a fresh
/// inspection, after fetching, must also find nothing that exists only here and no linked
/// worktrees. Otherwise its linked worktrees are removed through Git first, which deletes their
/// folders.
pub async fn delete_checkout(
    location: &CheckoutLocation,
    fingerprint: &str,
    discard_unique_work: bool,
    fetch: Fetch,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    if let Some(problem) = movable_problem(location) {
        return Ok(problem);
    }

    if !discard_unique_work && let Some(problem) = worktrees_problem(location).await? {
        return Ok(problem);
    }

    if discard_unique_work {
        if fingerprint_checkout(location, &read_ignored(&location.path).await?).await?
            != fingerprint
        {
            return Ok(skipped(SkipReason::ChangedSinceInspection));
        }
    } else {
        let inspection = inspect_checkout(location, fetch, context.cancel).await?;

        if inspection.fingerprint != fingerprint {
            return Ok(skipped(SkipReason::ChangedSinceInspection));
        }

        if !inspection.nothing_unique() {
            return Ok(skipped(SkipReason::UniqueWork));
        }
    }

    for worktree in git::read_linked_worktrees(&location.path, &location.common_directory).await? {
        // Git removes only a worktree whose link it can follow back to this repository.
        if worktree.state == WorktreeState::Broken {
            run_git_action(
                GitAction::new(
                    &location.path,
                    &["worktree", "repair", &worktree.path],
                    context.output,
                ),
                context.cancel,
            )
            .await?;
        }

        run_git_action(
            GitAction::new(
                &location.path,
                &["worktree", "remove", "--force", "--force", &worktree.path],
                context.output,
            ),
            context.cancel,
        )
        .await?;
    }

    if let Err(error) = store::remove_tree(location.path.clone()).await {
        return Ok(failed(format!(
            "Couldn't delete {}: Error: {error}",
            location.path
        )));
    }

    context
        .output
        .write(&format!("Deleted {}\n", location.path));

    Ok(succeeded(ActionResult::Deleted))
}

/// Moves a trashed checkout back to where it was, with a number added when something is there
/// now, and the worktrees trashed alongside it likewise. The trash record goes, but a worktree
/// that couldn't move back stays in the trash folder rather than being deleted with it.
pub async fn restore_checkout(
    trash: &str,
    id: &str,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let Some(item) = store::read_trash_item(trash, id) else {
        return Ok(skipped(SkipReason::NotInTrash));
    };
    let trashed = store::item_checkout_path(trash, id);
    let planned = match plan_checkout_move(
        &trashed,
        &paths::join(&trashed, ".git"),
        &item.original_path,
        |worktree| {
            item.worktrees
                .iter()
                .find(|entry| entry.trashed_path == worktree)
                .map(|entry| entry.original_path.clone())
        },
        WhenTaken::Number,
    )
    .await?
    {
        Ok(planned) => planned,
        Err(refused) => return Ok(refused),
    };

    if let Err(outcome) = perform_checkout_move(&planned, context).await {
        return Ok(outcome);
    }

    store::forget_trash_item(trash, id);

    Ok(succeeded(ActionResult::Restored {
        path: Some(planned.main.to),
        branch: None,
    }))
}

/// Deletes a trashed checkout for good.
pub async fn purge_checkout(
    trash: &str,
    id: &str,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let Some(item) = store::read_trash_item(trash, id) else {
        return Ok(skipped(SkipReason::NotInTrash));
    };

    if let Err(problem) = store::remove_trash_item(trash, id).await {
        return Ok(failed(problem));
    }

    context
        .output
        .write(&format!("Deleted {} from the trash\n", item.original_path));

    Ok(succeeded(ActionResult::Purged))
}
