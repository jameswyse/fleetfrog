//! What deleting a checkout, or removing one of its linked worktrees, would lose. Fingerprints are
//! computed exactly as the TypeScript agent computes them.

use std::time::Duration;

use crate::actions::detached::count_detached_commits;
use crate::git::{self, CheckoutLocation};
use crate::paths;
use crate::process::{
    Cancel, CommandFailed, GitAction, GitError, disk_usage, run_git, run_git_action,
};
use crate::protocol::{
    Capped, Count, Head, Inspection, MissingWorktree, RemoteCheck, SizedPath, UnpushedBranch,
    WorktreeInspection, WorktreeState,
};
use crate::t3code::sha256_hex;

/// Ignored folders and files that tools rebuild or recreate, such as dependencies, build output
/// and caches. Only ignored entries with these names count, so a tracked `build` folder never does.
const CACHE_NAMES: [&str; 26] = [
    "node_modules",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".parcel-cache",
    ".vite",
    ".expo",
    "dist",
    "build",
    "target",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".gradle",
    "coverage",
    ".nyc_output",
    "DerivedData",
    "Pods",
    ".dart_tool",
    ".eslintcache",
    ".DS_Store",
];

/// Build output with a name of its own, such as `.next-e2e` for a second Next.js build.
const CACHE_PREFIXES: [&str; 1] = [".next-"];
const CACHE_SUFFIXES: [&str; 2] = [".tsbuildinfo", ".pyc"];

fn is_cache(entry: &str) -> bool {
    let trimmed = entry.strip_suffix('/').unwrap_or(entry);
    let name = trimmed.rsplit('/').next().unwrap_or(trimmed);

    CACHE_NAMES.contains(&name)
        || CACHE_PREFIXES.iter().any(|prefix| name.starts_with(prefix))
        || CACHE_SUFFIXES.iter().any(|suffix| name.ends_with(suffix))
}

/// How many ignored entries the dashboard lists by name.
const IGNORED_LIST_LIMIT: usize = 100;
const FETCH_TIMEOUT: Duration = Duration::from_secs(90);

pub struct IgnoredEntries {
    pub caches: Vec<String>,
    pub other: Vec<String>,
}

/// Whether the inspection may fetch, which the owner allows with the `git` tier.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fetch {
    Allowed,
    NotAllowed,
}

/// The ignored files and folders, each folder once rather than everything inside it, split into
/// caches and anything else.
pub async fn read_ignored(path: &str) -> Result<IgnoredEntries, CommandFailed> {
    let output = run_git(
        path,
        &[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
            "--no-empty-directory",
            "-z",
        ],
    )
    .await?;
    let (caches, other) = output
        .split('\0')
        .filter(|entry| !entry.is_empty())
        .map(String::from)
        .partition(|entry| is_cache(entry));

    Ok(IgnoredEntries { caches, other })
}

fn digest(parts: &[&str]) -> String {
    sha256_hex(parts.join("\0").as_bytes())
}

/// A digest of what the checkout holds: HEAD, every ref other than remote-tracking branches, each
/// changed or untracked path, and each ignored entry, caches included, so a cache that appears
/// after the inspection isn't deleted unseen. Remote-tracking branches are left out, so fetching
/// doesn't change it.
pub async fn fingerprint_checkout(
    location: &CheckoutLocation,
    ignored: &IgnoredEntries,
) -> Result<String, CommandFailed> {
    let path = location.path.as_str();
    let (head, refs, status) = tokio::join!(
        run_git(path, &["rev-parse", "--symbolic-full-name", "HEAD"]),
        run_git(path, &["for-each-ref", "--format=%(refname) %(objectname)"]),
        run_git(
            path,
            &["status", "--porcelain=v2", "--untracked-files=all", "-z"]
        ),
    );
    let head = head.unwrap_or_else(|_| "unborn".into());
    let refs: Vec<&str> = refs
        .as_deref()
        .map_err(Clone::clone)?
        .split('\n')
        .filter(|line| !line.starts_with("refs/remotes/"))
        .collect();
    let refs = refs.join("\n");
    let status = status?;
    let commit = run_git(path, &["rev-parse", "--verify", "--quiet", "HEAD"])
        .await
        .unwrap_or_default();
    let mut parts = vec![
        head.as_str(),
        commit.as_str(),
        refs.as_str(),
        status.as_str(),
    ];

    parts.extend(ignored.other.iter().map(String::as_str));
    parts.push("");
    parts.extend(ignored.caches.iter().map(String::as_str));

    Ok(digest(&parts))
}

/// Fetches every remote so the inspection compares against what they have now.
async fn check_remotes(
    location: &CheckoutLocation,
    fetch: Fetch,
    stop: &Cancel,
) -> Result<RemoteCheck, CommandFailed> {
    if run_git(&location.path, &["remote"])
        .await?
        .trim()
        .is_empty()
    {
        return Ok(RemoteCheck::NoRemote);
    }

    if fetch == Fetch::NotAllowed {
        return Ok(RemoteCheck::Unreachable {
            message: "Git actions are turned off on this machine, so its remotes weren't fetched"
                .into(),
        });
    }

    // Stopping Git through its signal, rather than dropping it, stops SSH too and lets Git remove
    // its lock files.
    let cancel = stop.child();
    let fetching = run_git_action(
        GitAction::quiet(
            &location.path,
            &["fetch", "--all", "--prune", "--no-prune-tags"],
        ),
        &cancel,
    );

    tokio::pin!(fetching);

    let fetched = tokio::select! {
        fetched = &mut fetching => fetched,
        () = tokio::time::sleep(FETCH_TIMEOUT) => {
            cancel.cancel();
            let _ = fetching.await;

            return Ok(RemoteCheck::Unreachable { message: "Fetching took too long.".into() });
        }
    };

    Ok(match fetched {
        Ok(()) => RemoteCheck::Fetched,
        Err(GitError::Failed(message)) => RemoteCheck::Unreachable { message },
        Err(GitError::Interrupted) => RemoteCheck::Unreachable {
            message: "Fetching was stopped.".into(),
        },
    })
}

/// Tags no remote has, found by asking each remote for its tags.
async fn count_unpushed_tags(
    location: &CheckoutLocation,
    stop: &Cancel,
) -> Result<Count, GitError> {
    let local: Vec<String> = run_git(
        &location.path,
        &["for-each-ref", "--format=%(refname)", "refs/tags"],
    )
    .await?
    .split('\n')
    .filter(|name| !name.is_empty())
    .map(String::from)
    .collect();

    if local.is_empty() {
        return Ok(0);
    }

    let remotes = run_git(&location.path, &["remote"]).await?;
    let mut on_remotes = std::collections::HashSet::new();

    for remote in remotes.split('\n').filter(|remote| !remote.is_empty()) {
        let output = crate::output::ActionOutput::capturing();

        run_git_action(
            GitAction::new(
                &location.path,
                &["ls-remote", "--tags", "--refs", remote],
                &output,
            ),
            stop,
        )
        .await?;

        // Only lines in `ls-remote`'s own format count, so a warning on stderr is never a tag.
        for line in output.captured().split('\n') {
            if let Some((sha, name)) = line.split_once('\t')
                && (40..=64).contains(&sha.len())
                && sha
                    .bytes()
                    .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
                && name.starts_with("refs/tags/")
                && !name.contains(char::is_whitespace)
            {
                on_remotes.insert(name.to_string());
            }
        }
    }

    Ok(local
        .iter()
        .filter(|name| !on_remotes.contains(*name))
        .count() as Count)
}

/// Submodules whose Git directories are inside the checkout, holding work of their own.
fn count_submodules(location: &CheckoutLocation) -> Count {
    std::fs::read_dir(paths::join(&location.common_directory, "modules"))
        .map(|entries| entries.count() as Count)
        .unwrap_or(0)
}

/// Each path with its size, largest first.
pub fn sized(paths: &[String], sizes: &[u64]) -> Vec<SizedPath> {
    let mut sized: Vec<SizedPath> = paths
        .iter()
        .enumerate()
        .map(|(index, path)| SizedPath {
            path: path.clone(),
            size_bytes: sizes.get(index).copied().unwrap_or(0),
        })
        .collect();

    sized.sort_by_key(|entry| std::cmp::Reverse(entry.size_bytes));
    sized
}

fn capped(mut items: Vec<SizedPath>) -> Capped<SizedPath> {
    let total = items.len() as Count;

    items.truncate(IGNORED_LIST_LIMIT);
    Capped { items, total }
}

/// Finds what deleting the checkout would lose. It fetches every remote first, when allowed, so
/// commits count as safe only if a remote has them now.
///
/// `stop` stops its Git commands early, such as when the session ends.
pub async fn inspect_checkout(
    location: &CheckoutLocation,
    fetch: Fetch,
    stop: &Cancel,
) -> Result<Inspection, CommandFailed> {
    let remote = check_remotes(location, fetch, stop).await?;
    let status = git::read_git_status(location).await?;
    // Every ref counts, including notes and the trash's, and HEAD too, since a detached HEAD can
    // hold commits no branch has. Stashes are counted on their own.
    let mut args = vec!["rev-list", "--count", "--exclude=refs/stash", "--all"];

    if !matches!(status.head, Head::Unborn { .. }) {
        args.push("HEAD");
    }

    args.extend(["--not", "--remotes"]);

    let unpushed_commits = run_git(&location.path, &args)
        .await?
        .trim()
        .parse()
        .unwrap_or(0);
    let unpushed_tags = if remote == RemoteCheck::Fetched {
        count_unpushed_tags(location, stop).await.unwrap_or(0)
    } else {
        0
    };
    let ignored = read_ignored(&location.path).await?;
    let parent = paths::dirname(&location.path);
    let name = [paths::basename(&location.path)];
    let (total, cache_sizes, other_sizes) = tokio::join!(
        disk_usage(&parent, &name),
        disk_usage(&location.path, &ignored.caches),
        disk_usage(&location.path, &ignored.other)
    );
    let other = sized(&ignored.other, &other_sizes);
    let linked_worktrees = match location.worktree {
        crate::protocol::Worktree::Main => {
            git::count_linked_worktrees(&location.path, &location.common_directory).await?
        }
        crate::protocol::Worktree::Linked { .. } => 0,
    };

    Ok(Inspection {
        fingerprint: fingerprint_checkout(location, &ignored).await?,
        size_bytes: total.first().copied().unwrap_or(0),
        remote,
        unpushed_branches: status
            .branches
            .items
            .iter()
            .filter_map(|branch| {
                let commits = branch.tip.as_ref()?.local_commits;

                (commits > 0).then(|| UnpushedBranch {
                    name: branch.name.clone(),
                    commits,
                })
            })
            .collect(),
        unpushed_commits,
        unpushed_tags,
        operation: status.operation,
        submodules: count_submodules(location),
        stashes: status.stashes.total,
        changed_files: status.changed.total,
        untracked_files: status.untracked.total,
        ignored: capped(other),
        caches: sized(&ignored.caches, &cache_sizes),
        linked_worktrees,
    })
}

/// Changed and untracked paths from `git status --porcelain -z`, each counted once.
fn count_status(listing: &str) -> (Count, Count) {
    let entries: Vec<&str> = listing.split('\0').collect();
    let (mut changed, mut untracked) = (0, 0);
    let mut index = 0;

    while index < entries.len() {
        let entry = entries[index];

        if entry.starts_with("?? ") {
            untracked += 1;
        } else if !entry.is_empty() {
            changed += 1;

            // A rename or copy is followed by its old path, which isn't a change of its own.
            let mut codes = entry.chars();
            let (first, second) = (codes.next(), codes.next());

            if matches!(first, Some('R' | 'C')) || matches!(second, Some('R' | 'C')) {
                index += 1;
            }
        }

        index += 1;
    }

    (changed, untracked)
}

/// Reads what removing the linked worktree at `worktree` would do, or returns None when the main
/// checkout at `path` no longer lists it. A worktree whose link to the repository broke, such as
/// after the main checkout moved, is repaired first so Git can read it.
pub async fn inspect_worktree(
    path: &str,
    common_directory: &str,
    worktree: &str,
    stop: &Cancel,
) -> Result<Option<WorktreeInspection>, GitError> {
    let Some(found) = git::read_linked_worktrees(path, common_directory)
        .await?
        .into_iter()
        .find(|listed| listed.path == worktree)
    else {
        return Ok(None);
    };
    let locked = git::list_worktrees(path)
        .await?
        .into_iter()
        .find(|listed| listed.path == worktree)
        .and_then(|record| record.locked);
    let locked_text = locked.clone().unwrap_or_default();

    if found.state == WorktreeState::Missing {
        return Ok(Some(WorktreeInspection {
            fingerprint: digest(&["missing", &locked_text]),
            path: worktree.to_string(),
            missing: Some(MissingWorktree {
                parent_missing: std::fs::symlink_metadata(paths::dirname(worktree)).is_err(),
            }),
            branch: found.branch,
            locked,
            changed_files: 0,
            untracked_files: 0,
            unreachable_commits: 0,
            ignored: Capped {
                items: Vec::new(),
                total: 0,
            },
            caches: Vec::new(),
        }));
    }

    if found.state == WorktreeState::Broken {
        run_git_action(
            GitAction::quiet(path, &["worktree", "repair", worktree]),
            stop,
        )
        .await?;
    }

    let (head, commit, status) = tokio::join!(
        run_git(worktree, &["rev-parse", "--symbolic-full-name", "HEAD"]),
        run_git(worktree, &["rev-parse", "--verify", "--quiet", "HEAD"]),
        run_git(
            worktree,
            &["status", "--porcelain", "--untracked-files=all", "-z"]
        ),
    );
    let (head, commit, status) = (head?, commit.unwrap_or_default(), status?);
    let ignored = read_ignored(worktree).await?;
    let (cache_sizes, other_sizes) = tokio::join!(
        disk_usage(worktree, &ignored.caches),
        disk_usage(worktree, &ignored.other)
    );
    let other = sized(&ignored.other, &other_sizes);
    let mut parts = vec![
        head.as_str(),
        commit.as_str(),
        status.as_str(),
        locked_text.as_str(),
    ];

    parts.extend(ignored.other.iter().map(String::as_str));
    parts.push("");
    parts.extend(ignored.caches.iter().map(String::as_str));

    let (changed_files, untracked_files) = count_status(&status);
    let unreachable_commits = if found.branch.is_none() {
        count_detached_commits(worktree).await.unwrap_or(0)
    } else {
        0
    };

    Ok(Some(WorktreeInspection {
        fingerprint: digest(&parts),
        path: worktree.to_string(),
        missing: None,
        branch: found.branch,
        locked,
        changed_files,
        untracked_files,
        unreachable_commits,
        ignored: capped(other),
        caches: sized(&ignored.caches, &cache_sizes),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_caches() {
        assert!(is_cache("node_modules/"));
        assert!(is_cache("packages/web/.next-e2e/"));
        assert!(is_cache("tsconfig.tsbuildinfo"));
        assert!(!is_cache(".env"));
    }

    #[test]
    fn counts_status_entries_once() {
        assert_eq!(count_status(" M a\0R  new\0old\0?? u\0?? v\0"), (2, 2));
    }
}
