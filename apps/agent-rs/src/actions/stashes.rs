//! The stash trash: dropping stashes into it, and restoring or purging them.

use crate::git::CheckoutLocation;
use crate::process::{GitAction, GitError, run_git, run_git_action};
use crate::protocol::{
    ActionOutcome, ActionResult, Count, DROPPED_STASH_PREFIX, SkipReason, StashAtCommit,
    parse_dropped_stash_ref, skipped, succeeded,
};
use crate::time::Utc;

use super::Context;
use super::git_actions::ref_commit;

/// The commit each stash is, by index, newest first as `git stash list` numbers them.
async fn stash_commits(location: &CheckoutLocation) -> Result<Vec<String>, GitError> {
    Ok(run_git(&location.path, &["stash", "list", "--format=%H"])
        .await?
        .split('\n')
        .filter(|sha| !sha.is_empty())
        .map(String::from)
        .collect())
}

/// Moves stashes to the trash: each is kept as `refs/fleetfrog/stashes/<time>/<index>`, with the
/// index the dashboard showed, then dropped from the stash list. Each is found by its commit just
/// before it goes, since dropping one renumbers the ones after it, and a stash that's gone already
/// is left out. Keeping it first means a stop partway leaves no copy of a stash that wasn't dropped.
pub async fn drop_stashes(
    location: &CheckoutLocation,
    stashes: &[StashAtCommit],
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let dropped_at = Utc::now().millis();
    let mut dropped: Count = 0;

    for StashAtCommit { index, sha } in stashes {
        let Some(current) = stash_commits(location)
            .await?
            .iter()
            .position(|commit| commit == sha)
        else {
            continue;
        };
        let kept = format!("{DROPPED_STASH_PREFIX}{dropped_at}/{index}");
        let entry = format!("stash@{{{current}}}");

        run_git_action(
            GitAction::new(
                &location.path,
                &["update-ref", &kept, sha, ""],
                context.output,
            ),
            context.cancel,
        )
        .await?;
        run_git_action(
            GitAction::new(
                &location.path,
                &["stash", "drop", "--quiet", &entry],
                context.output,
            ),
            context.cancel,
        )
        .await?;
        dropped += 1;
    }

    Ok(if dropped == 0 {
        skipped(SkipReason::NoSuchStash)
    } else {
        succeeded(ActionResult::StashesDropped {
            stashes: dropped,
            missing: stashes.len() as Count - dropped,
        })
    })
}

/// The commit a dropped-stash ref keeps, or None when it isn't one or is gone.
async fn dropped_stash_commit(location: &CheckoutLocation, dropped: &str) -> Option<String> {
    parse_dropped_stash_ref(dropped)?;
    ref_commit(&location.path, dropped).await
}

/// Puts a dropped stash back at the top of the stash list, with its message.
pub async fn restore_stash(
    location: &CheckoutLocation,
    dropped: &str,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let Some(sha) = dropped_stash_commit(location, dropped).await else {
        return Ok(skipped(SkipReason::NotInTrash));
    };
    let message = run_git(&location.path, &["log", "-1", "--format=%s", &sha])
        .await?
        .trim()
        .to_string();

    run_git_action(
        GitAction::new(
            &location.path,
            &["stash", "store", "--message", &message, &sha],
            context.output,
        ),
        context.cancel,
    )
    .await?;
    run_git_action(
        GitAction::new(
            &location.path,
            &["update-ref", "-d", dropped, &sha],
            context.output,
        ),
        context.cancel,
    )
    .await?;

    Ok(succeeded(ActionResult::Restored {
        path: None,
        branch: None,
    }))
}

/// Forgets a dropped stash. Its commits go once Git's garbage collection finds them unreachable.
pub async fn purge_stash(
    location: &CheckoutLocation,
    dropped: &str,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let Some(sha) = dropped_stash_commit(location, dropped).await else {
        return Ok(skipped(SkipReason::NotInTrash));
    };

    run_git_action(
        GitAction::new(
            &location.path,
            &["update-ref", "-d", dropped, &sha],
            context.output,
        ),
        context.cancel,
    )
    .await?;

    Ok(succeeded(ActionResult::Purged))
}
