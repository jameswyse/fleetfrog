//! What changed in the agent between two versions, from the changelog changesets writes to
//! `apps/agent-rs/CHANGELOG.md`: a `## <version>` section for each release, with entries such as
//! `- de5e2e6: Fix …` under a heading for each kind of change, and continuation lines indented.

use std::cmp::Ordering;

use url::Url;

use super::compare_versions;
use crate::http;

/// Past this many entries the summary points to the full changelog instead.
pub const ENTRY_LIMIT: usize = 12;

#[derive(Debug, PartialEq, Eq)]
pub struct Release {
    pub version: String,
    /// Each entry's lines, without the commit that made it.
    pub entries: Vec<Vec<String>>,
}

/// The changelog as released with `version`, on GitHub's site, for people to read.
pub fn page_url(version: &str) -> String {
    format!("https://github.com/jameswyse/fleetfrog/blob/v{version}/apps/agent-rs/CHANGELOG.md")
}

pub async fn fetch(version: &str) -> Result<String, String> {
    let url = Url::parse(&format!(
        "https://raw.githubusercontent.com/jameswyse/fleetfrog/v{version}/apps/agent-rs/CHANGELOG.md"
    ))
    .map_err(|error| error.to_string())?;
    let body = http::get(&url).await.map_err(|error| error.to_string())?;

    Ok(String::from_utf8_lossy(&body).into_owned())
}

/// The commit changesets writes before each entry, such as `de5e2e6: `.
fn without_commit(text: &str) -> &str {
    match text.split_once(": ") {
        Some((commit, rest))
            if (7..=40).contains(&commit.len())
                && commit.bytes().all(|byte| byte.is_ascii_hexdigit()) =>
        {
            rest
        }
        _ => text,
    }
}

pub fn parse(markdown: &str) -> Vec<Release> {
    let mut releases: Vec<Release> = Vec::new();
    // Whether the last line belonged to an entry, which an indented line then continues.
    let mut in_entry = false;

    for line in markdown.lines() {
        if let Some(version) = line.strip_prefix("## ") {
            releases.push(Release {
                version: version.trim().to_string(),
                entries: Vec::new(),
            });
            in_entry = false;
            continue;
        }

        let Some(release) = releases.last_mut() else {
            continue;
        };

        if let Some(text) = line.strip_prefix("- ") {
            release
                .entries
                .push(vec![without_commit(text.trim()).to_string()]);
            in_entry = true;
        } else if line.trim().is_empty() {
            // A blank line separates an entry's paragraphs, so it doesn't end the entry.
        } else if in_entry && line.starts_with(char::is_whitespace) {
            if let Some(entry) = release.entries.last_mut() {
                entry.push(
                    line.strip_prefix("  ")
                        .unwrap_or(line)
                        .trim_end()
                        .to_string(),
                );
            }
        } else {
            in_entry = false;
        }
    }

    releases
}

/// The releases after `installed` up to and including `target` that have entries, newest first.
pub fn between(releases: Vec<Release>, installed: &str, target: &str) -> Vec<Release> {
    let mut selected: Vec<Release> = releases
        .into_iter()
        .filter(|release| {
            !release.entries.is_empty()
                && compare_versions(&release.version, installed) == Ordering::Greater
                && compare_versions(&release.version, target) != Ordering::Greater
        })
        .collect();

    selected.sort_by(|left, right| compare_versions(&right.version, &left.version));
    selected
}

/// Lists up to `limit` entries under their versions, and returns how many were left out.
pub fn summarise(releases: &[Release], limit: usize) -> (Vec<String>, usize) {
    let mut lines = Vec::new();
    let mut shown = 0;
    let mut omitted = 0;

    for release in releases {
        let room = limit - shown;

        omitted += release.entries.len().saturating_sub(room);

        if room == 0 {
            continue;
        }

        if !lines.is_empty() {
            lines.push(String::new());
        }

        lines.push(release.version.clone());

        for entry in release.entries.iter().take(room) {
            for (index, text) in entry.iter().enumerate() {
                lines.push(if index == 0 {
                    format!("  - {text}")
                } else {
                    format!("    {text}")
                });
            }

            shown += 1;
        }
    }

    (lines, omitted)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHANGELOG: &str = "# @fleetfrog/agent-rs

## 0.3.0

### Minor Changes

- 1a2b3c4: Update the agent from the dashboard.
  It restarts on the hub's version.

### Patch Changes

- 5d6e7f8: Fix: keep colons after the commit.

## 0.2.0

## 0.1.0

### Minor Changes

- de5e2e6: Add the agent as a native Rust binary.
";

    fn release(version: &str, entries: &[&[&str]]) -> Release {
        Release {
            version: version.into(),
            entries: entries
                .iter()
                .map(|entry| entry.iter().map(|line| line.to_string()).collect())
                .collect(),
        }
    }

    #[test]
    fn reads_entries_without_their_commits() {
        assert_eq!(
            parse(CHANGELOG),
            vec![
                release(
                    "0.3.0",
                    &[
                        &[
                            "Update the agent from the dashboard.",
                            "It restarts on the hub's version."
                        ],
                        &["Fix: keep colons after the commit."]
                    ]
                ),
                release("0.2.0", &[]),
                release("0.1.0", &[&["Add the agent as a native Rust binary."]]),
            ]
        );
    }

    #[test]
    fn keeps_releases_after_the_installed_version_up_to_the_target() {
        let releases = vec![
            release("0.1.10", &[&["c"]]),
            release("0.4.0", &[&["d"]]),
            release("0.2.0", &[&["b"]]),
            release("0.3.0", &[]),
            release("0.1.0", &[&["a"]]),
        ];
        let versions: Vec<String> = between(releases, "0.1.0", "0.3.0")
            .into_iter()
            .map(|release| release.version)
            .collect();

        assert_eq!(versions, ["0.2.0", "0.1.10"]);
    }

    #[test]
    fn caps_the_summary_and_counts_what_it_leaves_out() {
        let releases = vec![
            release("0.3.0", &[&["one", "more"], &["two"]]),
            release("0.2.0", &[&["three"], &["four"]]),
            release("0.1.1", &[&["five"]]),
        ];

        assert_eq!(
            summarise(&releases, 3),
            (
                vec![
                    "0.3.0".to_string(),
                    "  - one".into(),
                    "    more".into(),
                    "  - two".into(),
                    "".into(),
                    "0.2.0".into(),
                    "  - three".into(),
                ],
                2
            )
        );
        assert_eq!(summarise(&releases, ENTRY_LIMIT).1, 0);
    }
}
