//! Reading checkouts: where they are, what they are, and their Git status.

pub mod parse;
pub mod remote;

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use futures_util::StreamExt;
use futures_util::stream;

use crate::paths;
use crate::process::{CommandFailed, run_git};
use crate::protocol::{
    BranchTip, Capped, Commit, Count, GitStatus, Head, LinkedWorktree, LocalBranch, Operation,
    Placement, RepositoryIdentity, Stash, Worktree, WorktreeState,
};
use crate::time::Utc;

use parse::{
    BRANCH_FORMAT, LIST_LIMIT, ParsedBranch, ParsedRefs, REF_FORMAT, REF_PATTERNS, WorktreeRecord,
};

const STASH_LIMIT: usize = 50;

/// What discovery learns about a checkout. It changes rarely, so status passes reuse it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CheckoutLocation {
    pub path: String,
    pub identity: RepositoryIdentity,
    /// The main worktree's `origin`, in a form other machines can clone from.
    pub origin_url: Option<String>,
    pub worktree: Worktree,
    pub directory_name: String,
    pub placement: Placement,
    /// This worktree's own Git directory, which holds its HEAD and any operation in progress.
    pub git_directory: String,
    pub common_directory: String,
}

async fn read_origin(directory: &str) -> Option<String> {
    run_git(directory, &["config", "--get", "remote.origin.url"])
        .await
        .ok()
}

async fn identify(directory: &str, origin: Option<&str>) -> Option<RepositoryIdentity> {
    if let Some(identity) = origin.and_then(remote::remote_identity) {
        return Some(identity);
    }

    let roots = run_git(directory, &["rev-list", "--max-parents=0", "HEAD"])
        .await
        .ok()?;
    let mut shas: Vec<&str> = roots
        .trim()
        .split('\n')
        .filter(|sha| !sha.is_empty())
        .collect();

    shas.sort_unstable();
    shas.first().map(|sha| RepositoryIdentity::RootCommit {
        sha: sha.to_string(),
    })
}

/// Identifies the working tree at `directory`. Returns None for bare repositories and for
/// repositories with neither an `origin` remote nor any commits, which have no identity to share.
pub async fn locate_checkout(directory: &str) -> Option<CheckoutLocation> {
    let located = run_git(
        directory,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--git-dir",
            "--git-common-dir",
        ],
    )
    .await
    .ok()?;
    let mut lines = located.trim().split('\n');
    let toplevel = lines.next().unwrap_or("").to_string();
    let git_directory = lines.next().unwrap_or("").to_string();
    let common_directory = lines.next().unwrap_or("").to_string();
    let main = git_directory == common_directory;
    let main_path = if main {
        toplevel.clone()
    } else {
        paths::dirname(&common_directory)
    };
    let worktree = if main {
        Worktree::Main
    } else {
        Worktree::Linked {
            main_path: main_path.clone(),
        }
    };
    // Worktrees share the main worktree's remote and history, so they share its identity. An orphan
    // or unborn branch in a linked worktree would otherwise split the repository.
    let main_origin = read_origin(&main_path).await;
    let identity = match identify(&main_path, main_origin.as_deref()).await {
        None if main_path != toplevel => {
            identify(&toplevel, read_origin(&toplevel).await.as_deref()).await
        }
        identity => identity,
    }?;

    Some(CheckoutLocation {
        path: toplevel,
        identity,
        origin_url: main_origin.as_deref().and_then(remote::cloneable_url),
        worktree,
        directory_name: paths::basename(&main_path),
        // Discovery marks checkouts it finds in the Archive folder as archived.
        placement: Placement::Projects,
        git_directory,
        common_directory,
    })
}

/// The files Git leaves in a worktree's Git directory while each operation waits to continue.
const OPERATION_MARKERS: [(&str, Operation); 6] = [
    ("rebase-merge", Operation::Rebase),
    ("rebase-apply", Operation::Rebase),
    ("MERGE_HEAD", Operation::Merge),
    ("CHERRY_PICK_HEAD", Operation::CherryPick),
    ("REVERT_HEAD", Operation::Revert),
    ("BISECT_LOG", Operation::Bisect),
];

fn read_operation(git_directory: &str) -> Option<Operation> {
    OPERATION_MARKERS
        .iter()
        .find(|(marker, _)| std::fs::metadata(paths::join(git_directory, marker)).is_ok())
        .map(|(_, operation)| *operation)
}

/// Every worktree's Git directory: the common one and each linked worktree's.
pub fn git_directories(common_directory: &str) -> Vec<String> {
    let linked = paths::join(common_directory, "worktrees");
    let mut directories = vec![common_directory.to_string()];

    if let Ok(entries) = std::fs::read_dir(&linked) {
        directories.extend(
            entries
                .flatten()
                .map(|entry| paths::join(&linked, &entry.file_name().to_string_lossy())),
        );
    }

    directories
}

/// When any worktree of the repository last fetched. `FETCH_HEAD` is per worktree, but every
/// worktree shares the remote-tracking refs a fetch updates.
fn read_last_fetch(common_directory: &str) -> Option<Utc> {
    git_directories(common_directory)
        .iter()
        .filter_map(|directory| {
            std::fs::metadata(paths::join(directory, "FETCH_HEAD"))
                .ok()?
                .modified()
                .ok()
        })
        .max()
        .map(|modified| {
            Utc::from_millis(
                modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_millis() as i64)
                    .unwrap_or(0),
            )
        })
}

async fn read_stashes(directory: &str) -> Result<Vec<Stash>, CommandFailed> {
    let limit = format!("--max-count={STASH_LIMIT}");
    let output = run_git(directory, &["stash", "list", &limit, "--format=%H%x00%gs"]).await?;

    Ok(output
        .split('\n')
        .filter(|line| !line.is_empty())
        .enumerate()
        .map(|(index, line)| {
            let (sha, message) = line.split_once('\0').unwrap_or((line, ""));

            Stash {
                index: index as Count,
                message: message.to_string(),
                sha: Some(sha.to_string()),
            }
        })
        .collect())
}

async fn read_commit(directory: &str) -> Result<Commit, CommandFailed> {
    let output = run_git(directory, &["log", "-1", "--format=%H%x00%cI%x00%s"]).await?;
    let mut fields = output.trim_end().split('\0');
    let mut next = || fields.next().unwrap_or("").to_string();
    let (sha, committed_at, subject) = (next(), next(), next());

    Ok(Commit {
        sha,
        subject,
        committed_at: parse::commit_time(&committed_at),
    })
}

/// Counts of commits in no remote-tracking branch, by tip, for each repository. They only change
/// when the remote-tracking branches do, so status passes reuse them.
/// By common directory: the remote-tracking refs the counts were made against, and the counts by tip.
type LocalCommitCounts = HashMap<String, (String, HashMap<String, Count>)>;

static LOCAL_COMMITS: LazyLock<Mutex<LocalCommitCounts>> = LazyLock::new(Default::default);

async fn count_local_commits(
    directory: &str,
    common_directory: &str,
    remotes: &str,
    sha: &str,
) -> Result<Count, CommandFailed> {
    {
        let mut cache = LOCAL_COMMITS.lock().unwrap();
        let entry = cache.entry(common_directory.to_string()).or_default();

        if entry.0 != remotes {
            *entry = (remotes.to_string(), HashMap::new());
        }

        if let Some(count) = entry.1.get(sha) {
            return Ok(*count);
        }
    }

    let output = run_git(
        directory,
        &["rev-list", "--count", sha, "--not", "--remotes"],
    )
    .await?;
    let count = output.trim().parse().unwrap_or(0);
    let mut cache = LOCAL_COMMITS.lock().unwrap();

    if let Some(entry) = cache
        .get_mut(common_directory)
        .filter(|entry| entry.0 == remotes)
    {
        entry.1.insert(sha.to_string(), count);
    }

    Ok(count)
}

/// Adds to each branch where its tip is: in the default branch, on a remote, or only here. A tip is
/// on a remote exactly when no commit before it is only here.
async fn read_branch_tips(
    location: &CheckoutLocation,
    branches: Vec<ParsedBranch>,
    refs: &ParsedRefs,
) -> Result<Vec<LocalBranch>, CommandFailed> {
    let merged: HashSet<String> = match &refs.default_ref {
        None => HashSet::new(),
        Some(default_ref) => {
            let merged_flag = format!("--merged={default_ref}");

            run_git(
                &location.path,
                &[
                    "for-each-ref",
                    "refs/heads",
                    "--format=%(refname:lstrip=2)",
                    &merged_flag,
                ],
            )
            .await?
            .split('\n')
            .filter(|name| !name.is_empty())
            .map(String::from)
            .collect()
        }
    };
    let remotes = refs.remote_refs.join("\n");
    let counted: Vec<Result<LocalBranch, CommandFailed>> = stream::iter(branches)
        .map(|branch| {
            let merged = &merged;
            let remotes = &remotes;

            async move {
                let local_commits = count_local_commits(
                    &location.path,
                    &location.common_directory,
                    remotes,
                    &branch.tip.sha,
                )
                .await?;

                Ok(LocalBranch {
                    upstream: branch.upstream,
                    tip: Some(BranchTip {
                        merged: merged.contains(&branch.name),
                        pushed: local_commits == 0,
                        local_commits,
                        sha: branch.tip.sha,
                        subject: branch.tip.subject,
                        committed_at: branch.tip.committed_at,
                    }),
                    name: branch.name,
                })
            }
        })
        .buffered(4)
        .collect()
        .await;

    counted.into_iter().collect()
}

/// Every worktree of the repository at `directory`, the main one first.
pub async fn list_worktrees(directory: &str) -> Result<Vec<WorktreeRecord>, CommandFailed> {
    Ok(parse::parse_worktree_list(
        &run_git(directory, &["worktree", "list", "--porcelain"]).await?,
    ))
}

/// Whether the worktree's `.git` file still leads to this repository. It stops doing so when the
/// main checkout moves, since Git records the path.
fn links_back(worktree: &str, common_directory: &str) -> bool {
    let Ok(link) = std::fs::read_to_string(paths::join(worktree, ".git")) else {
        return false;
    };
    let Some(target) = link.trim().strip_prefix("gitdir: ") else {
        return false;
    };

    match (
        std::fs::canonicalize(target),
        std::fs::canonicalize(common_directory),
    ) {
        (Ok(target), Ok(common)) => target.to_string_lossy().starts_with(&format!(
            "{}/",
            paths::join(&common.to_string_lossy(), "worktrees")
        )),
        _ => false,
    }
}

/// The clone's linked worktrees, each with whether its folder is there and still linked.
pub async fn read_linked_worktrees(
    path: &str,
    common_directory: &str,
) -> Result<Vec<LinkedWorktree>, CommandFailed> {
    let records = list_worktrees(path).await?;

    Ok(records
        .into_iter()
        .skip(1)
        .map(|record| {
            let state = if record.prunable {
                WorktreeState::Missing
            } else if links_back(&record.path, common_directory) {
                WorktreeState::Present
            } else {
                WorktreeState::Broken
            };

            LinkedWorktree {
                path: record.path,
                branch: record.branch,
                state,
            }
        })
        .collect())
}

/// Linked worktrees whose folders still exist, which moving the clone would break.
pub async fn count_linked_worktrees(
    path: &str,
    common_directory: &str,
) -> Result<Count, CommandFailed> {
    Ok(read_linked_worktrees(path, common_directory)
        .await?
        .iter()
        .filter(|worktree| worktree.state != WorktreeState::Missing)
        .count() as Count)
}

fn capped<T>(mut items: Vec<T>) -> Capped<T> {
    let total = items.len() as Count;

    items.truncate(LIST_LIMIT);
    Capped { items, total }
}

pub async fn read_git_status(location: &CheckoutLocation) -> Result<GitStatus, CommandFailed> {
    let branch_format = format!("--format={BRANCH_FORMAT}");
    let ref_format = format!("--format={REF_FORMAT}");
    let mut ref_args = vec!["for-each-ref", ref_format.as_str()];

    ref_args.extend(REF_PATTERNS);

    let branch_args = ["for-each-ref", "refs/heads", branch_format.as_str()];
    let (status_output, branch_output, ref_output) = tokio::try_join!(
        run_git(
            &location.path,
            &[
                "status",
                "--porcelain=v2",
                "--branch",
                "--show-stash",
                "--untracked-files=normal",
                "-z"
            ]
        ),
        run_git(&location.path, &branch_args),
        run_git(&location.path, &ref_args),
    )?;
    let last_fetched_at = read_last_fetch(&location.common_directory);
    let operation = read_operation(&location.git_directory);
    let status = parse::parse_status(&status_output);
    let branches = parse::parse_branches(&branch_output);
    let refs = parse::parse_refs(&ref_output);
    let branch_items = read_branch_tips(location, branches.items, &refs).await?;
    // Every worktree shares the clone's refs and worktree list, so only the main worktree reports
    // them.
    let main = location.worktree == Worktree::Main;
    let worktrees = if main {
        read_linked_worktrees(&location.path, &location.common_directory).await?
    } else {
        Vec::new()
    };
    let stashes = if status.stash_count > 0 {
        read_stashes(&location.path).await?
    } else {
        Vec::new()
    };
    let last_commit = if status.head == Head::Detached && status.commit.is_some() {
        Some(read_commit(&location.path).await?)
    } else {
        branches.current_commit
    };
    let ParsedRefs {
        default_ref,
        deleted,
        dropped_stashes,
        ..
    } = refs;

    Ok(GitStatus {
        head: status.head,
        operation,
        last_commit,
        changed: status.changed,
        untracked: status.untracked,
        stashes: Capped {
            items: stashes,
            total: status.stash_count,
        },
        branches: Capped {
            items: branch_items,
            total: branches.total,
        },
        default_branch: default_ref.map(|default_ref| {
            default_ref
                .strip_prefix("refs/remotes/origin/")
                .map(String::from)
                .unwrap_or(default_ref)
        }),
        deleted_branches: capped(if main { deleted } else { Vec::new() }),
        dropped_stashes: capped(if main { dropped_stashes } else { Vec::new() }),
        worktrees,
        last_fetched_at,
    })
}
