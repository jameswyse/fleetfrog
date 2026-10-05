//! Fetching, pulling, switching, stashing, cloning and the branch trash.

use std::collections::HashSet;

use crate::git::{self, CheckoutLocation, remote::cloneable_url};
use crate::paths::{self, DestinationCheck};
use crate::process::{GitAction, GitError, run_git, run_git_action};
use crate::protocol::{
    ActionOutcome, ActionResult, BranchAtCommit, Count, DELETED_BRANCH_PREFIX, GitStatus, Head,
    SkipReason, SkippedBranch, failed, parse_deleted_ref, skipped, succeeded,
};
use crate::time::{Utc, stash_date};

use super::Context;
use super::detached::keep_detached_commits;
use super::stashes::{stash_tip, trash_new_stash};

/// Why a pull would skip this checkout, or None when it can go ahead. A pull only fast-forwards,
/// so the checkout must be on a branch with an upstream, with nothing to push and no changes to
/// tracked files. Shared with the dashboard as `pullBlocker`.
pub fn pull_blocker(git: &GitStatus) -> Option<SkipReason> {
    if let Some(operation) = git.operation {
        return Some(SkipReason::OperationInProgress { operation });
    }

    let upstream = match &git.head {
        Head::Detached => return Some(SkipReason::Detached),
        Head::Unborn { .. } => return Some(SkipReason::NoCommits),
        Head::Branch { upstream: None, .. } => return Some(SkipReason::NoUpstream),
        Head::Branch {
            upstream: Some(upstream),
            ..
        } => upstream,
    };

    if upstream.gone {
        Some(SkipReason::UpstreamGone)
    } else if git.changed.total > 0 {
        Some(SkipReason::UncommittedChanges {
            files: git.changed.total,
        })
    } else if upstream.ahead > 0 {
        Some(SkipReason::UnpushedCommits {
            commits: upstream.ahead,
        })
    } else {
        None
    }
}

/// Why stashing would be skipped, or None. Shared with the dashboard as `stashBlocker`.
pub fn stash_blocker(git: &GitStatus) -> Option<SkipReason> {
    if let Some(operation) = git.operation {
        Some(SkipReason::OperationInProgress { operation })
    } else if matches!(git.head, Head::Unborn { .. }) {
        Some(SkipReason::NoCommits)
    } else if git.changed.total + git.untracked.total == 0 {
        Some(SkipReason::NothingToStash)
    } else {
        None
    }
}

pub fn discard_blocker(git: &GitStatus) -> Option<SkipReason> {
    match stash_blocker(git) {
        Some(SkipReason::NothingToStash) => Some(SkipReason::NoChanges),
        blocker => blocker,
    }
}

/// Why switching to `branch` can't happen, or None. Shared with the dashboard as `switchBlocker`.
pub fn switch_blocker(git: &GitStatus, branch: &str) -> Option<SkipReason> {
    if let Some(operation) = git.operation {
        return Some(SkipReason::OperationInProgress { operation });
    }

    if git.head.name() == Some(branch) {
        return Some(SkipReason::AlreadyOnBranch);
    }

    let listed = git
        .branches
        .items
        .iter()
        .any(|listed| listed.name == branch);

    // A branch past the end of a truncated list may still exist, so only a full list can rule it out.
    (!listed && git.branches.items.len() as Count == git.branches.total)
        .then_some(SkipReason::NoSuchBranch)
}

async fn fetch_all(location: &CheckoutLocation, context: &Context<'_>) -> Result<(), GitError> {
    // Tags stay, even where the user's configuration would prune them.
    run_git_action(
        GitAction::new(
            &location.path,
            &["fetch", "--all", "--prune", "--no-prune-tags", "--progress"],
            context.output,
        ),
        context.cancel,
    )
    .await
}

/// Fetches every remote of the repository. Worktrees share remote-tracking refs, so one is enough.
pub async fn fetch_repository(
    location: &CheckoutLocation,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    fetch_all(location, context).await?;

    Ok(succeeded(ActionResult::Fetched))
}

/// Fetches and fast-forwards the checked-out branch. The checkout's state is checked before the
/// fetch and again after it, so changes made meanwhile still stop the pull.
pub async fn pull_checkout(
    location: &CheckoutLocation,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    if let Some(reason) = pull_blocker(&git::read_git_status(location).await?) {
        return Ok(skipped(reason));
    }

    fetch_all(location, context).await?;

    let status = git::read_git_status(location).await?;

    if let Some(reason) = pull_blocker(&status) {
        return Ok(skipped(reason));
    }

    let behind = match &status.head {
        Head::Branch {
            upstream: Some(upstream),
            ..
        } => upstream.behind,
        _ => 0,
    };

    if behind == 0 {
        return Ok(succeeded(ActionResult::UpToDate));
    }

    // Git also refuses if the merge would overwrite an untracked file or a change made just now.
    run_git_action(
        GitAction::new(
            &location.path,
            &["merge", "--ff-only", "@{upstream}"],
            context.output,
        ),
        context.cancel,
    )
    .await?;

    Ok(succeeded(ActionResult::FastForwarded { commits: behind }))
}

/// The commit a ref points at, or None when there is no such ref.
pub async fn ref_commit(path: &str, name: &str) -> Option<String> {
    run_git(
        path,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{name}^{{commit}}"),
        ],
    )
    .await
    .ok()
    .map(|sha| sha.trim().to_string())
}

/// Files in a worktree's Git directory naming a branch an operation is part-way through.
const NOTHING_DISCARDED: &str = "Git found no changes it could stash, so nothing was discarded. Changes inside a submodule have to be discarded in the submodule.";

const OPERATION_BRANCH_FILES: [&str; 3] = [
    "rebase-merge/head-name",
    "rebase-apply/head-name",
    "BISECT_START",
];

/// The branches any worktree of the repository has checked out, this one included, or is part-way
/// through rebasing or bisecting, when HEAD is detached but the branch is still in use.
async fn branches_in_use(location: &CheckoutLocation) -> Result<HashSet<String>, GitError> {
    let mut in_use: HashSet<String> = git::list_worktrees(&location.path)
        .await?
        .into_iter()
        .filter_map(|record| record.branch)
        .collect();

    for directory in git::git_directories(&location.common_directory) {
        for file in OPERATION_BRANCH_FILES {
            if let Ok(text) = std::fs::read_to_string(paths::join(&directory, file)) {
                let text = text.trim();
                let name = text.strip_prefix("refs/heads/").unwrap_or(text);

                if !name.is_empty() {
                    in_use.insert(name.to_string());
                }
            }
        }
    }

    Ok(in_use)
}

/// Whether Git accepts `name` as a branch name, so it can't be read as anything else.
async fn is_branch_name(path: &str, name: &str) -> bool {
    run_git(path, &["check-ref-format", &format!("refs/heads/{name}")])
        .await
        .is_ok()
        && !name.starts_with('-')
}

/// Switches the checkout to one of its local branches, which no other worktree may have checked
/// out. Changes to tracked files are stashed first with `stash_changes`, moved to the trash with
/// `discard_changes`, and otherwise stop the switch. Commits only a detached HEAD holds go to the
/// trash.
pub async fn switch_branch(
    location: &CheckoutLocation,
    branch: &str,
    stash_changes: bool,
    discard_changes: bool,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let status = git::read_git_status(location).await?;

    if let Some(reason) = switch_blocker(&status, branch) {
        return Ok(skipped(reason));
    }

    if !(is_branch_name(&location.path, branch).await
        && ref_commit(&location.path, &format!("refs/heads/{branch}"))
            .await
            .is_some())
    {
        return Ok(skipped(SkipReason::NoSuchBranch));
    }

    if branches_in_use(location).await?.contains(branch) {
        return Ok(skipped(SkipReason::BranchInUse));
    }

    let changed_files = status.changed.total;
    let mut discarded = false;

    if changed_files > 0 {
        if !stash_changes && !discard_changes {
            return Ok(skipped(SkipReason::UncommittedChanges {
                files: changed_files,
            }));
        }

        // Untracked files stay, as they would for a switch without changes.
        let verb = if discard_changes {
            "Discarded"
        } else {
            "Stashed"
        };
        let message = format!(
            "{verb} from FleetFrog before switching to {branch} on {}",
            stash_date(Utc::now())
        );

        let before = stash_tip(&location.path).await?;

        run_git_action(
            GitAction::new(
                &location.path,
                &["stash", "push", "--message", &message],
                context.output,
            ),
            context.cancel,
        )
        .await?;

        if discard_changes {
            discarded = trash_new_stash(&location.path, before.as_deref(), context).await?;
        }
    }

    let saved_commits = if status.head == Head::Detached {
        keep_detached_commits(&location.path, context).await?
    } else {
        0
    };

    run_git_action(
        GitAction::new(
            &location.path,
            &["switch", "--no-guess", branch],
            context.output,
        ),
        context.cancel,
    )
    .await?;

    let (stashed_files, discarded_files) = match (discard_changes, discarded) {
        (false, _) => (changed_files, 0),
        (true, true) => (0, changed_files),
        (true, false) => (0, 0),
    };

    Ok(succeeded(ActionResult::Switched {
        branch: branch.to_string(),
        stashed_files,
        discarded_files,
        saved_commits,
    }))
}

/// Stashes every change, untracked files included, so the working tree is clean and the changes
/// can be brought back with `git stash pop`. Ignored files stay where they are.
pub async fn stash_changes(
    location: &CheckoutLocation,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let status = git::read_git_status(location).await?;

    if let Some(reason) = stash_blocker(&status) {
        return Ok(skipped(reason));
    }

    let message = format!("Stashed from FleetFrog on {}", stash_date(Utc::now()));

    run_git_action(
        GitAction::new(
            &location.path,
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

    Ok(succeeded(ActionResult::Stashed {
        files: status.changed.total + status.untracked.total,
    }))
}

pub async fn discard_changes(
    location: &CheckoutLocation,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let status = git::read_git_status(location).await?;

    if let Some(reason) = discard_blocker(&status) {
        return Ok(skipped(reason));
    }

    let message = format!("Discarded from FleetFrog on {}", stash_date(Utc::now()));
    let before = stash_tip(&location.path).await?;

    run_git_action(
        GitAction::new(
            &location.path,
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

    if !trash_new_stash(&location.path, before.as_deref(), context).await? {
        return Ok(failed(NOTHING_DISCARDED));
    }

    Ok(succeeded(ActionResult::Discarded {
        files: status.changed.total + status.untracked.total,
    }))
}

/// Why a clone destination was refused, for each way it can fail the path checks.
pub fn destination_problem(check: &DestinationCheck) -> Option<&'static str> {
    match check {
        DestinationCheck::Valid { .. } => None,
        DestinationCheck::NotAbsolute => {
            Some("The destination must be an absolute path or start with ~.")
        }
        DestinationCheck::Hidden => {
            Some("The destination can't be in a hidden folder or contain . or .. segments.")
        }
        DestinationCheck::OutsideRoots => {
            Some("The destination must be inside one of this machine's project folders.")
        }
        DestinationCheck::InArchive => Some("The destination can't be in the Archive folder."),
    }
}

/// The path with every existing ancestor's symbolic links resolved.
fn resolve_existing(target: &str) -> std::io::Result<String> {
    let mut missing: Vec<String> = Vec::new();
    let mut existing = target.to_string();

    loop {
        match std::fs::canonicalize(&existing) {
            Ok(resolved) => {
                let mut path = resolved.to_string_lossy().into_owned();

                for part in missing.iter().rev() {
                    path = paths::join(&path, part);
                }

                return Ok(path);
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound
                    && paths::dirname(&existing) != existing =>
            {
                missing.push(paths::basename(&existing));
                existing = paths::dirname(&existing);
            }
            Err(error) => return Err(error),
        }
    }
}

/// Why a destination that passed the path checks still can't be cloned into, or None when it can.
/// Its discovery folder must exist, it must not, and with symbolic links resolved it must still
/// pass the path checks, so a link can't lead the clone elsewhere.
fn clone_destination_problem(
    target: &str,
    root: &str,
    home: &str,
    archive: Option<&str>,
) -> std::io::Result<Option<String>> {
    if !std::fs::metadata(root).is_ok_and(|found| found.is_dir()) {
        return Ok(Some(format!(
            "The project folder {root} doesn't exist on this machine."
        )));
    }

    if std::fs::symlink_metadata(target).is_ok() {
        return Ok(Some(format!("{target} already exists.")));
    }

    let resolved_root = std::fs::canonicalize(root)?.to_string_lossy().into_owned();
    let check =
        paths::check_clone_destination(&resolve_existing(target)?, home, &[resolved_root], archive);

    Ok(destination_problem(&check).map(String::from))
}

/// Clones a remote into a new folder inside a discovery folder, checking out its default branch.
/// The destination has already passed the path checks.
pub async fn clone_repository(
    url: &str,
    target: &str,
    root: &str,
    home: &str,
    archive: Option<&str>,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    // The URL must already be in the shared form, so nothing else is quietly rewritten.
    if cloneable_url(url).as_deref() != Some(url) {
        return Ok(failed(
            "Only HTTPS and SSH remotes without credentials can be cloned.",
        ));
    }

    let problem = clone_destination_problem(target, &paths::expand_home(root, home), home, archive)
        .unwrap_or_else(|error| Some(format!("Couldn't check the destination: Error: {error}")));

    if let Some(problem) = problem {
        return Ok(failed(problem));
    }

    let mut action = GitAction::new(
        home,
        &["clone", "--progress", "--", url, target],
        context.output,
    );

    // Only the transports the URL check allows, including for anything the clone fetches.
    action.environment = &[("GIT_ALLOW_PROTOCOL", "https:ssh")];
    run_git_action(action, context.cancel).await?;

    Ok(succeeded(ActionResult::Cloned))
}

/// Why one requested branch must stay, or None when it can be deleted.
async fn branch_skip_reason(
    location: &CheckoutLocation,
    name: &str,
    sha: &str,
    in_use: &HashSet<String>,
) -> Option<SkipReason> {
    if !is_branch_name(&location.path, name).await {
        return Some(SkipReason::NoSuchBranch);
    }

    if in_use.contains(name) {
        return Some(SkipReason::BranchCheckedOut {
            branch: name.to_string(),
        });
    }

    (ref_commit(&location.path, &format!("refs/heads/{name}"))
        .await
        .as_deref()
        != Some(sha))
    .then(|| SkipReason::BranchChanged {
        branch: name.to_string(),
    })
}

/// Moves branches to the trash: each is kept as `refs/fleetfrog/deleted/<time>/<name>` and removed
/// from `refs/heads` in one transaction, which Git applies only if every branch in it still points
/// at the commit the dashboard showed. A branch that moved or is in use by a worktree is left out
/// of the transaction and reported as skipped.
pub async fn delete_branches(
    location: &CheckoutLocation,
    branches: &[BranchAtCommit],
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let in_use = branches_in_use(location).await?;
    let mut deletable = Vec::new();
    let mut skipped_branches = Vec::new();

    for BranchAtCommit { name, sha } in branches {
        match branch_skip_reason(location, name, sha, &in_use).await {
            None => deletable.push((name.clone(), sha.clone())),
            Some(reason) => skipped_branches.push(SkippedBranch {
                branch: name.clone(),
                reason,
            }),
        }
    }

    if deletable.is_empty()
        && let Some(first) = skipped_branches.first()
    {
        return Ok(skipped(first.reason.clone()));
    }

    let deleted_at = Utc::now().millis();
    let mut input = String::new();

    for (name, sha) in &deletable {
        input.push_str(&format!("create {DELETED_BRANCH_PREFIX}{deleted_at}/{name} {sha}\ndelete refs/heads/{name} {sha}\n"));
    }

    let mut action = GitAction::new(&location.path, &["update-ref", "--stdin"], context.output);

    action.input = Some(input);
    run_git_action(action, context.cancel).await?;

    // The branch's upstream and other settings go too, as `git branch -D` would remove them.
    for (name, _) in &deletable {
        let _ = run_git(
            &location.path,
            &["config", "--remove-section", &format!("branch.{name}")],
        )
        .await;
    }

    Ok(succeeded(ActionResult::BranchesDeleted {
        branches: deletable.len() as Count,
        skipped: skipped_branches,
    }))
}

/// The first of `name`, `name-restored`, `name-restored-2` and so on that no branch has.
async fn free_branch_name(path: &str, name: &str) -> String {
    let mut attempt = 1;

    loop {
        let candidate = match attempt {
            1 => name.to_string(),
            2 => format!("{name}-restored"),
            _ => format!("{name}-restored-{}", attempt - 1),
        };

        if ref_commit(path, &format!("refs/heads/{candidate}"))
            .await
            .is_none()
        {
            return candidate;
        }

        attempt += 1;
    }
}

/// Recreates a deleted branch at its commit, as `name-restored` when a branch with its name exists
/// now.
pub async fn restore_branch(
    location: &CheckoutLocation,
    deleted: &str,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let Some((name, _)) = parse_deleted_ref(deleted) else {
        return Ok(skipped(SkipReason::NotInTrash));
    };
    let Some(sha) = ref_commit(&location.path, deleted).await else {
        return Ok(skipped(SkipReason::NotInTrash));
    };

    if !is_branch_name(&location.path, &name).await {
        return Ok(skipped(SkipReason::NotInTrash));
    }

    let branch = free_branch_name(&location.path, &name).await;
    let mut action = GitAction::new(&location.path, &["update-ref", "--stdin"], context.output);

    action.input = Some(format!(
        "create refs/heads/{branch} {sha}\ndelete {deleted} {sha}\n"
    ));
    run_git_action(action, context.cancel).await?;

    Ok(succeeded(ActionResult::Restored {
        path: None,
        branch: Some(branch),
    }))
}

/// Forgets a deleted branch. Its commits go once Git's garbage collection finds them unreachable.
pub async fn purge_branch(
    location: &CheckoutLocation,
    deleted: &str,
    context: &Context<'_>,
) -> Result<ActionOutcome, GitError> {
    let sha = match parse_deleted_ref(deleted) {
        None => None,
        Some(_) => ref_commit(&location.path, deleted).await,
    };
    let Some(sha) = sha else {
        return Ok(skipped(SkipReason::NotInTrash));
    };

    run_git_action(
        GitAction::new(
            &location.path,
            &["update-ref", "-d", deleted, &sha],
            context.output,
        ),
        context.cancel,
    )
    .await?;

    Ok(succeeded(ActionResult::Purged))
}
