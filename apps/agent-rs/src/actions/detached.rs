use crate::process::{CommandFailed, GitAction, GitError, run_git, run_git_action};
use crate::protocol::{Count, DELETED_BRANCH_PREFIX};
use crate::time::Utc;

use super::Context;

/// How many commits HEAD in the worktree at `directory` holds that no branch, tag or remote has.
pub async fn count_detached_commits(directory: &str) -> Result<Count, CommandFailed> {
    let output = run_git(
        directory,
        &[
            "rev-list",
            "--count",
            "HEAD",
            "--not",
            "--branches",
            "--tags",
            "--remotes",
            "--glob=refs/fleetfrog/*",
        ],
    )
    .await?;

    Ok(output.trim().parse().unwrap_or(0))
}

/// Keeps the commits only a detached HEAD holds as a deleted branch named after its commit, such
/// as `detached-1a2b3c4`, so they appear in the trash and can be restored as that branch. Returns
/// how many commits it kept, which is 0 when every commit is on a ref already.
pub async fn keep_detached_commits(
    directory: &str,
    context: &Context<'_>,
) -> Result<Count, GitError> {
    let commits = count_detached_commits(directory).await?;

    if commits == 0 {
        return Ok(0);
    }

    let sha = run_git(directory, &["rev-parse", "--verify", "HEAD"])
        .await?
        .trim()
        .to_string();
    let kept = format!(
        "{DELETED_BRANCH_PREFIX}{}/detached-{}",
        Utc::now().millis(),
        &sha[..sha.len().min(7)]
    );

    run_git_action(
        GitAction::new(directory, &["update-ref", &kept, &sha, ""], context.output),
        context.cancel,
    )
    .await?;

    Ok(commits)
}
