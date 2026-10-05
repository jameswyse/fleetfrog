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

pub async fn stash_tip(cwd: &str) -> Result<Option<String>, GitError> {
    let sha = run_git(cwd, &["stash", "list", "-1", "--format=%H"]).await?;
    let sha = sha.trim();

    Ok((!sha.is_empty()).then(|| sha.to_string()))
}

pub async fn trash_new_stash(
    cwd: &str,
    before: Option<&str>,
    context: &Context<'_>,
) -> Result<bool, GitError> {
    let Some(sha) = stash_tip(cwd).await? else {
        return Ok(false);
    };

    if before == Some(sha.as_str()) {
        return Ok(false);
    }

    let kept = format!("{DROPPED_STASH_PREFIX}{}/0", Utc::now().millis());

    run_git_action(
        GitAction::new(cwd, &["update-ref", &kept, &sha, ""], context.output),
        context.cancel,
    )
    .await?;
    run_git_action(
        GitAction::new(
            cwd,
            &["stash", "drop", "--quiet", "stash@{0}"],
            context.output,
        ),
        context.cancel,
    )
    .await?;

    Ok(true)
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::output::ActionOutput;
    use crate::process::Cancel;
    use std::path::PathBuf;
    use std::process::Command;

    fn git(cwd: &PathBuf, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
            .args(args)
            .current_dir(cwd)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output()
            .unwrap();

        assert!(output.status.success(), "git {args:?} failed");
        String::from_utf8(output.stdout).unwrap().trim().to_string()
    }

    #[tokio::test]
    async fn trashes_only_a_stash_the_push_made() {
        let root = std::env::temp_dir().join(format!(
            "fleetfrog-stashes-{}-{}",
            std::process::id(),
            Utc::now().millis()
        ));

        std::fs::create_dir_all(&root).unwrap();
        git(&root, &["init", "-q", "-b", "main"]);
        std::fs::write(root.join("readme.md"), "one\n").unwrap();
        git(&root, &["add", "."]);
        git(&root, &["commit", "-q", "-m", "First"]);
        std::fs::write(root.join("readme.md"), "kept\n").unwrap();
        git(&root, &["stash", "push", "-q", "-m", "user stash"]);

        let cwd = root.to_str().unwrap();
        let output = ActionOutput::new();
        let cancel = Cancel::new();
        let context = Context {
            output: &output,
            cancel: &cancel,
        };
        let before = stash_tip(cwd).await.unwrap();

        assert!(before.is_some());
        assert!(
            !trash_new_stash(cwd, before.as_deref(), &context)
                .await
                .unwrap()
        );
        assert!(git(&root, &["stash", "list"]).contains("user stash"));

        std::fs::write(root.join("readme.md"), "discarded\n").unwrap();
        git(&root, &["stash", "push", "-q", "-m", "discarded"]);

        assert!(
            trash_new_stash(cwd, before.as_deref(), &context)
                .await
                .unwrap()
        );
        assert_eq!(
            git(&root, &["stash", "list", "--format=%s"]),
            "On main: user stash"
        );
        assert!(
            git(&root, &["for-each-ref", "--format=%(refname)"]).contains(DROPPED_STASH_PREFIX)
        );

        std::fs::remove_dir_all(&root).unwrap();
    }
}
