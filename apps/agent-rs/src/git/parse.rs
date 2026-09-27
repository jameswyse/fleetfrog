//! Parsers for the Git output the agent reads.

use crate::protocol::{
    Capped, ChangedFile, Commit, Count, DeletedBranch, DroppedStash, Head, Upstream,
    parse_deleted_ref, parse_dropped_stash_ref,
};
use crate::time::Utc;

/// Lists sent to the hub stop here; totals still count everything.
pub const LIST_LIMIT: usize = 200;

pub struct ParsedStatus {
    pub head: Head,
    /// The checked-out commit, absent on an unborn branch.
    pub commit: Option<String>,
    pub changed: Capped<ChangedFile>,
    pub untracked: Capped<String>,
    pub stash_count: Count,
}

const FILE_STATES: [&str; 8] = [".", "M", "T", "A", "D", "R", "C", "U"];

fn file_state(code: Option<char>) -> &'static str {
    code.and_then(|code| {
        FILE_STATES
            .iter()
            .find(|state| state.starts_with(code))
            .copied()
    })
    .unwrap_or(".")
}

/// Parses `git status --porcelain=v2 --branch --show-stash -z`.
/// See the "Porcelain Format Version 2" section of git-status(1).
pub fn parse_status(output: &str) -> ParsedStatus {
    let records: Vec<&str> = output.split('\0').collect();
    let mut commit = None;
    let mut branch = None;
    let mut upstream = None;
    let mut ahead: Option<Count> = None;
    let mut behind: Option<Count> = None;
    let mut stash_count = 0;
    let mut changed = Vec::new();
    let mut changed_total = 0;
    let mut untracked = Vec::new();
    let mut untracked_total = 0;
    let mut index = 0;

    while index < records.len() {
        let record = records[index];

        if let Some(header) = record.strip_prefix("# ") {
            let mut words = header.split(' ');
            let key = words.next().unwrap_or("");
            let rest: Vec<&str> = words.collect();
            let value = rest.join(" ");

            match key {
                "branch.oid" => commit = (value != "(initial)").then_some(value),
                "branch.head" => branch = (value != "(detached)").then_some(value),
                "branch.upstream" => upstream = Some(value),
                "branch.ab" => {
                    let count = |part: Option<&&str>| {
                        part.and_then(|part| part.get(1..))
                            .and_then(|digits| digits.parse().ok())
                    };

                    ahead = Some(count(rest.first()).unwrap_or(0));
                    behind = Some(count(rest.get(1)).unwrap_or(0));
                }
                "stash" => stash_count = value.parse().unwrap_or(0),
                _ => {}
            }
        } else if let Some(path) = record.strip_prefix("? ") {
            untracked_total += 1;

            if untracked.len() < LIST_LIMIT {
                untracked.push(path.to_string());
            }
        } else if let Some(kind @ ('1' | '2' | 'u')) = record
            .chars()
            .next()
            .filter(|_| record.as_bytes().get(1) == Some(&b' '))
        {
            let fields: Vec<&str> = record.split(' ').collect();
            // Ordinary, renamed or copied, and unmerged entries have 8, 9 and 10 fields before the path.
            let before_path = match kind {
                '1' => 8,
                '2' => 9,
                _ => 10,
            };
            let path = fields
                .get(before_path..)
                .map(|parts| parts.join(" "))
                .unwrap_or_default();
            let mut states = fields.get(1).copied().unwrap_or("..").chars();
            // A rename's original path is the next NUL-separated record.
            let original_path = if kind == '2' {
                index += 1;
                records.get(index).map(|path| path.to_string())
            } else {
                None
            };

            changed_total += 1;

            if changed.len() < LIST_LIMIT {
                changed.push(ChangedFile {
                    path,
                    original_path,
                    staged: file_state(states.next()),
                    unstaged: file_state(states.next()),
                });
            }
        }

        index += 1;
    }

    let head = match branch {
        None => Head::Detached,
        Some(name) if commit.is_none() => Head::Unborn { name },
        Some(name) => Head::Branch {
            name,
            upstream: upstream.map(|name| Upstream {
                name,
                ahead: ahead.unwrap_or(0),
                behind: behind.unwrap_or(0),
                // Git omits the ahead/behind header when the upstream ref no longer exists.
                gone: ahead.is_none(),
            }),
        },
    };

    ParsedStatus {
        head,
        commit,
        changed: Capped {
            items: changed,
            total: changed_total,
        },
        untracked: Capped {
            items: untracked,
            total: untracked_total,
        },
        stash_count,
    }
}

pub const BRANCH_FORMAT: &str = "%(HEAD)%00%(refname:lstrip=2)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(objectname)%00%(committerdate:iso-strict)%00%(contents:subject)";

/// A local branch with its newest commit, before its reachability from remotes is known.
pub struct ParsedBranch {
    pub name: String,
    pub upstream: Option<Upstream>,
    pub tip: Commit,
}

pub struct ParsedBranches {
    pub items: Vec<ParsedBranch>,
    pub total: Count,
    /// The tip of the checked-out branch, absent when HEAD is detached or unborn.
    pub current_commit: Option<Commit>,
}

fn upstream_from(name: &str, track: &str) -> Option<Upstream> {
    if name.is_empty() {
        return None;
    }

    let mut upstream = Upstream {
        name: name.to_string(),
        ahead: 0,
        behind: 0,
        gone: track == "gone",
    };

    for part in track.split(", ") {
        if let Some((direction, count)) = part.split_once(' ')
            && !count.is_empty()
            && count.bytes().all(|byte| byte.is_ascii_digit())
        {
            match direction {
                "ahead" => upstream.ahead = count.parse().unwrap_or(0),
                "behind" => upstream.behind = count.parse().unwrap_or(0),
                _ => {}
            }
        }
    }

    Some(upstream)
}

/// A commit time from Git, or the epoch when Git gave none, as JavaScript's invalid date would
/// otherwise fail the whole report.
pub fn commit_time(text: &str) -> Utc {
    Utc::parse(text).unwrap_or(Utc::EPOCH)
}

/// Parses `git for-each-ref refs/heads --format=<BRANCH_FORMAT>`.
pub fn parse_branches(output: &str) -> ParsedBranches {
    let mut items = Vec::new();
    let mut total = 0;
    let mut current_commit = None;

    for line in output.split('\n').filter(|line| !line.is_empty()) {
        let mut fields = line.split('\0');
        let mut next = || fields.next().unwrap_or("");
        let (marker, name, upstream, track, sha, committed_at, subject) =
            (next(), next(), next(), next(), next(), next(), next());
        let tip = Commit {
            sha: sha.to_string(),
            subject: subject.to_string(),
            committed_at: commit_time(committed_at),
        };

        total += 1;

        if marker == "*" {
            current_commit = Some(tip.clone());
        }

        if items.len() < LIST_LIMIT {
            items.push(ParsedBranch {
                name: name.to_string(),
                upstream: upstream_from(upstream, track),
                tip,
            });
        }
    }

    ParsedBranches {
        items,
        total,
        current_commit,
    }
}

/// Reads remote-tracking branches, deleted branches and dropped stashes in one pass.
pub const REF_FORMAT: &str =
    "%(refname)%00%(objectname)%00%(symref)%00%(committerdate:iso-strict)%00%(contents:subject)";
pub const REF_PATTERNS: [&str; 3] = [
    "refs/remotes",
    "refs/fleetfrog/deleted",
    "refs/fleetfrog/stashes",
];

#[derive(Default)]
pub struct ParsedRefs {
    /// Every remote-tracking branch with its commit, as `<ref> <sha>`, leaving out symbolic refs.
    pub remote_refs: Vec<String>,
    /// The ref `origin/HEAD` points at, such as `refs/remotes/origin/main`.
    pub default_ref: Option<String>,
    /// Newest first.
    pub deleted: Vec<DeletedBranch>,
    /// Newest first.
    pub dropped_stashes: Vec<DroppedStash>,
}

/// Parses `git for-each-ref <REF_PATTERNS> --format=<REF_FORMAT>`.
pub fn parse_refs(output: &str) -> ParsedRefs {
    let mut refs = ParsedRefs::default();

    for line in output.split('\n') {
        let fields: Vec<&str> = line.split('\0').collect();
        let field = |index: usize| fields.get(index).copied().unwrap_or("");
        let (name, sha, symref, subject) = (field(0), field(1), field(2), field(4));

        if name == "refs/remotes/origin/HEAD" {
            refs.default_ref = (!symref.is_empty()).then(|| symref.to_string());
        } else if name.starts_with("refs/remotes/") && symref.is_empty() {
            refs.remote_refs.push(format!("{name} {sha}"));
        } else if let Some(dropped_at) = parse_dropped_stash_ref(name) {
            refs.dropped_stashes.push(DroppedStash {
                r#ref: name.to_string(),
                sha: sha.to_string(),
                message: subject.to_string(),
                dropped_at: Utc::from_millis(dropped_at),
            });
        } else if let Some((branch, deleted_at)) = parse_deleted_ref(name) {
            refs.deleted.push(DeletedBranch {
                name: branch,
                r#ref: name.to_string(),
                sha: sha.to_string(),
                subject: subject.to_string(),
                deleted_at: Utc::from_millis(deleted_at),
            });
        }
    }

    refs.deleted
        .sort_by_key(|deleted| std::cmp::Reverse(deleted.deleted_at));
    refs.dropped_stashes
        .sort_by_key(|dropped| std::cmp::Reverse(dropped.dropped_at));
    refs
}

/// One record of `git worktree list --porcelain`. The first is always the main worktree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeRecord {
    pub path: String,
    /// The checked-out branch, or None when HEAD is detached.
    pub branch: Option<String>,
    /// Git has noticed the folder is gone.
    pub prunable: bool,
    /// Why the worktree is locked against removal, possibly empty, or None when it isn't.
    pub locked: Option<String>,
    pub bare: bool,
}

/// Parses `git worktree list --porcelain`, whose records are separated by blank lines.
pub fn parse_worktree_list(output: &str) -> Vec<WorktreeRecord> {
    output
        .split("\n\n")
        .filter_map(|record| {
            let lines: Vec<&str> = record.split('\n').collect();
            let path = lines
                .iter()
                .find_map(|line| line.strip_prefix("worktree "))?;

            Some(WorktreeRecord {
                path: path.to_string(),
                branch: lines
                    .iter()
                    .find_map(|line| line.strip_prefix("branch refs/heads/"))
                    .map(String::from),
                prunable: lines.iter().any(|line| line.starts_with("prunable")),
                locked: lines
                    .iter()
                    .find(|line| **line == "locked" || line.starts_with("locked "))
                    .map(|line| line["locked".len()..].trim().to_string()),
                bare: lines.contains(&"bare"),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2_status() {
        let output = [
            "# branch.oid 1234",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -3",
            "# stash 4",
            "1 .M N... 100644 100644 100644 aaa bbb file with spaces.txt",
            "2 R. N... 100644 100644 100644 aaa bbb R100 new.txt",
            "old.txt",
            "u UU N... 100644 100644 100644 100644 a b c conflict.txt",
            "? untracked.txt",
            "",
        ]
        .join("\0");
        let status = parse_status(&output);

        assert_eq!(
            status.head,
            Head::Branch {
                name: "main".into(),
                upstream: Some(Upstream {
                    name: "origin/main".into(),
                    ahead: 2,
                    behind: 3,
                    gone: false
                })
            }
        );
        assert_eq!(status.stash_count, 4);
        assert_eq!(status.changed.total, 3);
        assert_eq!(status.changed.items[0].path, "file with spaces.txt");
        assert_eq!(
            (
                status.changed.items[0].staged,
                status.changed.items[0].unstaged
            ),
            (".", "M")
        );
        assert_eq!(
            status.changed.items[1].original_path.as_deref(),
            Some("old.txt")
        );
        assert_eq!(status.changed.items[2].path, "conflict.txt");
        assert_eq!(status.untracked.items, vec!["untracked.txt"]);
    }

    #[test]
    fn reads_gone_detached_and_unborn_heads() {
        let gone = parse_status("# branch.oid 1\0# branch.head b\0# branch.upstream origin/b\0");

        assert_eq!(
            gone.head,
            Head::Branch {
                name: "b".into(),
                upstream: Some(Upstream {
                    name: "origin/b".into(),
                    ahead: 0,
                    behind: 0,
                    gone: true
                })
            }
        );
        assert_eq!(
            parse_status("# branch.oid 1\0# branch.head (detached)\0").head,
            Head::Detached
        );
        assert_eq!(
            parse_status("# branch.oid (initial)\0# branch.head main\0").head,
            Head::Unborn {
                name: "main".into()
            }
        );
    }

    #[test]
    fn parses_branches_and_refs() {
        let branches = parse_branches(
            "*\0main\0origin/main\0ahead 1, behind 2\0abc\x002026-09-27T14:05:00+10:00\0Subject\n \0old\0\0\0def\x002026-09-26T00:00:00Z\0Old\n",
        );

        assert_eq!(branches.total, 2);
        assert_eq!(
            branches
                .current_commit
                .as_ref()
                .map(|commit| commit.sha.as_str()),
            Some("abc")
        );
        assert_eq!(
            branches.items[0].upstream,
            Some(Upstream {
                name: "origin/main".into(),
                ahead: 1,
                behind: 2,
                gone: false
            })
        );
        assert_eq!(branches.items[1].upstream, None);

        let refs = parse_refs(
            "refs/remotes/origin/HEAD\0\0refs/remotes/origin/main\0\0\nrefs/remotes/origin/main\0abc\0\0\0\nrefs/fleetfrog/deleted/1/a\0s1\0\0\0A\nrefs/fleetfrog/deleted/2/b\0s2\0\0\0B\nrefs/fleetfrog/stashes/3/0\0s3\0\0\0On main: x\n",
        );

        assert_eq!(
            refs.default_ref.as_deref(),
            Some("refs/remotes/origin/main")
        );
        assert_eq!(refs.remote_refs, vec!["refs/remotes/origin/main abc"]);
        assert_eq!(
            refs.deleted
                .iter()
                .map(|branch| branch.name.as_str())
                .collect::<Vec<_>>(),
            vec!["b", "a"]
        );
        assert_eq!(refs.dropped_stashes[0].message, "On main: x");
    }

    #[test]
    fn parses_worktree_lists() {
        let records = parse_worktree_list(
            "worktree /main\nHEAD abc\nbranch refs/heads/main\n\nworktree /linked\nHEAD def\ndetached\nlocked reason here\nprunable gitdir file points to non-existent location\n\n",
        );

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].branch.as_deref(), Some("main"));
        assert_eq!(records[1].locked.as_deref(), Some("reason here"));
        assert!(records[1].prunable);
    }
}
