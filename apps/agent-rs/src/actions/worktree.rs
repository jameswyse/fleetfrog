use crate::inspect::inspect_worktree;
use crate::process::{GitAction, GitError, run_git_action};
use crate::protocol::{
    ActionOutcome, ActionResult, SkipReason, WorktreeInspection, skipped, succeeded,
};
use crate::time::{Utc, stash_date};

use super::Context;
use super::detached::keep_detached_commits;

/// Git needs forcing twice to remove a locked worktree, and once to forget a missing one.
fn force_flags(inspection: &WorktreeInspection) -> &'static [&'static str] {
    if inspection.locked.is_some() {
        &["--force", "--force"]
    } else if inspection.missing.is_some() {
        &["--force"]
    } else {
        &[]
    }
}

/// Removes a linked worktree of the main checkout at `path`, keeping its branch, if it still
/// matches the inspection the dashboard showed. Its changes and untracked files are stashed first,
/// and commits only its detached HEAD holds go to the trash, so only its ignored files are lost.
/// One whose folder is gone is only forgotten, and a locked one is unlocked, both as the dashboard
/// warned.
pub async fn remove_worktree(
    path: &str,
    common_directory: &str,
    worktree: &str,
    fingerprint: &str,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let Some(inspection) =
        inspect_worktree(path, common_directory, worktree, context.cancel).await?
    else {
        return Ok(skipped(SkipReason::NoSuchWorktree));
    };

    if inspection.fingerprint != fingerprint {
        return Ok(skipped(SkipReason::ChangedSinceInspection));
    }

    let stashed_files = inspection.changed_files + inspection.untracked_files;

    if stashed_files > 0 {
        let message = format!(
            "Stashed from FleetFrog before removing the worktree at {worktree} on {}",
            stash_date(Utc::now())
        );

        run_git_action(
            GitAction::new(
                worktree,
                &[
                    "stash",
                    "push",
                    "--include-untracked",
                    "--message",
                    &message,
                ],
                context.output,
            ),
            context.cancel,
        )
        .await?;
    }

    let saved_commits = if inspection.unreachable_commits > 0 {
        keep_detached_commits(worktree, context).await?
    } else {
        0
    };
    let mut args = vec!["worktree", "remove"];

    args.extend(force_flags(&inspection));
    args.push(worktree);
    run_git_action(GitAction::new(path, &args, context.output), context.cancel).await?;

    Ok(succeeded(ActionResult::WorktreeRemoved {
        stashed_files,
        saved_commits,
        deleted_ignored: inspection.ignored.total,
    }))
}
