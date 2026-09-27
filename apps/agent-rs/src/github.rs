//! Default-branch and pull request state from GitHub, read through `gh` at most once per
//! repository per interval, however many checkouts share it.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;

use crate::git::CheckoutLocation;
use crate::paths;
use crate::process::{run_git, run_tool};
use crate::protocol::{Count, GithubState, MergedPullRequest, PullRequest, RepositoryIdentity};
use crate::time::Utc;

const QUERY: &str = "query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name target { oid } }
    pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number title url headRefName isDraft isCrossRepository headRepositoryOwner { login } }
    }
    merged: pullRequests(states: MERGED, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number url headRefName headRefOid isCrossRepository headRepositoryOwner { login } }
    }
  }
}";

#[derive(Deserialize)]
struct Login {
    login: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenNode {
    number: Count,
    title: String,
    url: String,
    head_ref_name: String,
    is_draft: bool,
    is_cross_repository: bool,
    // Null when the fork that opened the pull request has been deleted.
    head_repository_owner: Option<Login>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MergedNode {
    number: Count,
    url: String,
    head_ref_name: String,
    head_ref_oid: String,
    is_cross_repository: bool,
    head_repository_owner: Option<Login>,
}

#[derive(Deserialize)]
struct Nodes<T> {
    nodes: Vec<T>,
}

#[derive(Deserialize)]
struct Target {
    oid: String,
}

#[derive(Deserialize)]
struct DefaultBranchRef {
    name: String,
    target: Target,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    default_branch_ref: DefaultBranchRef,
    pull_requests: Nodes<OpenNode>,
    merged: Nodes<MergedNode>,
}

#[derive(Deserialize)]
struct Data {
    repository: Repository,
}

#[derive(Deserialize)]
struct Response {
    data: Data,
}

#[derive(Clone)]
struct RemoteState {
    default_branch: String,
    remote_sha: String,
    pull_requests: Vec<PullRequest>,
    merged_pull_requests: Vec<MergedPullRequest>,
    checked_at: Utc,
}

pub struct GithubReader {
    /// The signed-in GitHub user, whose fork's pull requests also count as this repository's.
    login: String,
    cache: Mutex<HashMap<String, RemoteState>>,
}

impl GithubReader {
    pub fn new(login: String) -> GithubReader {
        GithubReader {
            login,
            cache: Mutex::new(HashMap::new()),
        }
    }

    async fn fetch(&self, owner: &str, name: &str) -> Result<RemoteState, String> {
        let query = format!("query={QUERY}");
        let owner = format!("owner={owner}");
        let name = format!("name={name}");
        // `-f` sends raw strings; `-F` would turn a repository called `2048` into a number.
        let output = run_tool(
            "gh",
            &paths::home(),
            &["api", "graphql", "-f", &query, "-f", &owner, "-f", &name],
        )
        .await
        .map_err(|error| error.message)?;
        let repository = serde_json::from_str::<Response>(&output)
            .map_err(|error| error.to_string())?
            .data
            .repository;
        // A fork's `main` is not the local `main`, so only branches pushed here or to our fork match.
        let ours = |cross: bool, owner: &Option<Login>| {
            !cross
                || owner
                    .as_ref()
                    .is_some_and(|owner| owner.login == self.login)
        };

        Ok(RemoteState {
            default_branch: repository.default_branch_ref.name,
            remote_sha: repository.default_branch_ref.target.oid,
            pull_requests: repository
                .pull_requests
                .nodes
                .into_iter()
                .filter(|node| ours(node.is_cross_repository, &node.head_repository_owner))
                .map(|node| PullRequest {
                    number: node.number,
                    title: node.title,
                    url: node.url,
                    branch: node.head_ref_name,
                    draft: node.is_draft,
                })
                .collect(),
            merged_pull_requests: repository
                .merged
                .nodes
                .into_iter()
                .filter(|node| ours(node.is_cross_repository, &node.head_repository_owner))
                .map(|node| MergedPullRequest {
                    number: node.number,
                    url: node.url,
                    branch: node.head_ref_name,
                    sha: node.head_ref_oid,
                })
                .collect(),
            checked_at: Utc::now(),
        })
    }

    /// Returns None for repositories not hosted on GitHub or when GitHub cannot be reached.
    pub async fn read(
        &self,
        location: &CheckoutLocation,
        local_branches: &[String],
        maximum_age: Duration,
    ) -> Option<GithubState> {
        let RepositoryIdentity::Remote { host, path } = &location.identity else {
            return None;
        };
        let parts: Vec<&str> = path.split('/').collect();

        if host != "github.com" || parts.len() != 2 || parts.iter().any(|part| part.is_empty()) {
            return None;
        }

        let key = location.identity.key();
        let now = Utc::now();
        let cached = self.cache.lock().unwrap().get(&key).cloned();
        let remote = match cached.filter(|cached| {
            ((now.millis() - cached.checked_at.millis()).max(0) as u128) < maximum_age.as_millis()
        }) {
            Some(cached) => cached,
            None => match self.fetch(parts[0], parts[1]).await {
                Ok(state) => {
                    self.cache.lock().unwrap().insert(key, state.clone());
                    state
                }
                Err(error) => {
                    crate::log::warning("GitHub state unavailable", error);
                    return None;
                }
            },
        };
        let tracking = format!("refs/remotes/origin/{}", remote.default_branch);
        let tracking_sha = run_git(
            &location.path,
            &["rev-parse", "--verify", "--quiet", &tracking],
        )
        .await
        .ok()
        .map(|sha| sha.trim().to_string());
        let branches: HashSet<&String> = local_branches.iter().collect();

        Some(GithubState {
            default_branch: remote.default_branch,
            remote_sha: remote.remote_sha,
            tracking_sha,
            pull_requests: remote
                .pull_requests
                .into_iter()
                .filter(|pull| branches.contains(&pull.branch))
                .collect(),
            merged_pull_requests: remote
                .merged_pull_requests
                .into_iter()
                .filter(|pull| branches.contains(&pull.branch))
                .collect(),
            checked_at: remote.checked_at,
        })
    }
}
