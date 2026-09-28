//! The agent's side of `@fleetfrog/protocol`, as the JSON the hub encodes and decodes. Field names,
//! tags and optional fields follow the Effect schemas in `packages/protocol/src`, which own them.

use serde::{Deserialize, Serialize};

use crate::time::Utc;

pub type Count = u64;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Git,
    Cleanup,
    Update,
}

impl Tier {
    pub const ALL: [Tier; 3] = [Tier::Git, Tier::Cleanup, Tier::Update];

    pub fn as_str(self) -> &'static str {
        match self {
            Tier::Git => "git",
            Tier::Cleanup => "cleanup",
            Tier::Update => "update",
        }
    }

    /// What the tier covers, as the subject of a sentence.
    pub fn plural_name(self) -> &'static str {
        match self {
            Tier::Git => "Git actions",
            Tier::Cleanup => "Cleanup actions",
            Tier::Update => "Agent updates",
        }
    }

    /// Whether the tier is allowed on a machine whose owner hasn't decided. The agent records this
    /// in the policy the first time it meets the tier, so changing a default later leaves existing
    /// machines as they were.
    pub fn allowed_by_default(self) -> bool {
        match self {
            Tier::Git | Tier::Cleanup | Tier::Update => true,
        }
    }

    pub fn parse(text: &str) -> Option<Tier> {
        Tier::ALL.into_iter().find(|tier| tier.as_str() == text)
    }
}

/// Every action this agent knows, in the protocol's order.
pub const ACTION_KINDS: [&str; 14] = [
    "Fetch",
    "Pull",
    "Clone",
    "Switch",
    "Stash",
    "DeleteBranches",
    "RemoveWorktree",
    "DropStashes",
    "Archive",
    "Unarchive",
    "Trash",
    "Delete",
    "Restore",
    "Purge",
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct BranchAtCommit {
    pub name: String,
    pub sha: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct StashAtCommit {
    pub index: Count,
    pub sha: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag")]
pub enum TrashTarget {
    Branch { path: String, r#ref: String },
    Stash { path: String, r#ref: String },
    Checkout { id: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag", rename_all_fields = "camelCase")]
pub enum ActionRequest {
    Fetch {
        path: String,
    },
    Pull {
        path: String,
    },
    Clone {
        url: String,
        destination: String,
    },
    Switch {
        path: String,
        branch: String,
        #[serde(default)]
        stash_changes: bool,
    },
    Stash {
        path: String,
    },
    DeleteBranches {
        path: String,
        branches: Vec<BranchAtCommit>,
    },
    RemoveWorktree {
        path: String,
        worktree: String,
        fingerprint: String,
    },
    DropStashes {
        path: String,
        stashes: Vec<StashAtCommit>,
    },
    Archive {
        path: String,
    },
    Unarchive {
        path: String,
    },
    Trash {
        path: String,
        fingerprint: String,
        remove_caches: bool,
    },
    Delete {
        path: String,
        fingerprint: String,
        #[serde(default)]
        discard_unique_work: bool,
    },
    Restore {
        target: TrashTarget,
    },
    Purge {
        target: TrashTarget,
    },
}

impl ActionRequest {
    pub fn tier(&self) -> Tier {
        match self {
            ActionRequest::Fetch { .. }
            | ActionRequest::Pull { .. }
            | ActionRequest::Clone { .. }
            | ActionRequest::Switch { .. }
            | ActionRequest::Stash { .. } => Tier::Git,
            _ => Tier::Cleanup,
        }
    }

    /// The checks the protocol's schemas make beyond the shape serde decodes: non-empty lists, and
    /// trash ids that are UUIDs, since an id names a folder in the trash.
    pub fn is_valid(&self) -> bool {
        match self {
            ActionRequest::DeleteBranches { branches, .. } => !branches.is_empty(),
            ActionRequest::DropStashes { stashes, .. } => !stashes.is_empty(),
            ActionRequest::Restore {
                target: TrashTarget::Checkout { id },
            }
            | ActionRequest::Purge {
                target: TrashTarget::Checkout { id },
            } => crate::config::is_uuid(id),
            _ => true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Operation {
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Bisect,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag")]
pub enum SkipReason {
    Detached,
    NoCommits,
    NoUpstream,
    UpstreamGone,
    UncommittedChanges { files: Count },
    UnpushedCommits { commits: Count },
    OperationInProgress { operation: Operation },
    NothingToStash,
    AlreadyOnBranch,
    BranchInUse,
    NoSuchBranch,
    BranchChanged { branch: String },
    BranchCheckedOut { branch: String },
    DefaultBranch { branch: String },
    BranchExists { branch: String },
    NotInTrash,
    NoArchiveFolder,
    NoSuchWorktree,
    StashesChanged,
    NoSuchStash,
    HasWorktrees { count: Count },
    IsWorktree,
    DestinationTaken { path: String },
    DestinationsClash { path: String },
    UnreachableCommits { commits: Count },
    IgnoredFiles { files: Count },
    ChangedSinceInspection,
    UniqueWork,
    NotAllowed { tier: Tier },
    AgentOutdated,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SkippedBranch {
    pub branch: String,
    pub reason: SkipReason,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct MovedFolder {
    pub from: String,
    pub to: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag", rename_all_fields = "camelCase")]
pub enum ActionResult {
    Fetched,
    FastForwarded {
        commits: Count,
    },
    UpToDate,
    Cloned,
    Switched {
        branch: String,
        stashed_files: Count,
        saved_commits: Count,
    },
    Stashed {
        files: Count,
    },
    BranchesDeleted {
        branches: Count,
        skipped: Vec<SkippedBranch>,
    },
    Archived {
        path: String,
        worktrees: Vec<MovedFolder>,
    },
    Unarchived {
        path: String,
        worktrees: Vec<MovedFolder>,
    },
    WorktreeRemoved {
        stashed_files: Count,
        saved_commits: Count,
        deleted_ignored: Count,
    },
    StashesDropped {
        stashes: Count,
        missing: Count,
    },
    Trashed {
        freed_bytes: Count,
    },
    Deleted,
    Restored {
        path: Option<String>,
        branch: Option<String>,
    },
    Purged,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag")]
pub enum ActionOutcome {
    Succeeded { result: ActionResult },
    Failed { message: String },
    Skipped { reason: SkipReason },
    Cancelled,
    Interrupted,
    MachineOffline,
}

pub fn failed(message: impl Into<String>) -> ActionOutcome {
    ActionOutcome::Failed {
        message: message.into(),
    }
}

pub fn skipped(reason: SkipReason) -> ActionOutcome {
    ActionOutcome::Skipped { reason }
}

pub fn succeeded(result: ActionResult) -> ActionOutcome {
    ActionOutcome::Succeeded { result }
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "_tag")]
pub enum ActionUpdate {
    Started,
    Progress {
        line: String,
    },
    Finished {
        outcome: ActionOutcome,
        output: Vec<String>,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    pub actions: Vec<&'static str>,
    pub allowed_tiers: Vec<Tier>,
    pub policy_readable: bool,
    pub creates_folders: bool,
    /// Whether the hub may send `Update`. Only release builds can replace themselves.
    pub updates_itself: bool,
}

// Checkouts.

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
#[serde(tag = "_tag")]
pub enum RepositoryIdentity {
    Remote { host: String, path: String },
    RootCommit { sha: String },
}

impl RepositoryIdentity {
    pub fn key(&self) -> String {
        match self {
            RepositoryIdentity::Remote { host, path } => format!("remote:{host}/{path}"),
            RepositoryIdentity::RootCommit { sha } => format!("root:{sha}"),
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub original_path: Option<String>,
    pub staged: &'static str,
    pub unstaged: &'static str,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Capped<T> {
    pub items: Vec<T>,
    pub total: Count,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Upstream {
    pub name: String,
    pub ahead: Count,
    pub behind: Count,
    pub gone: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag")]
pub enum Head {
    Branch {
        name: String,
        upstream: Option<Upstream>,
    },
    Detached,
    Unborn {
        name: String,
    },
}

impl Head {
    /// The branch name, unless HEAD is detached.
    pub fn name(&self) -> Option<&str> {
        match self {
            Head::Branch { name, .. } | Head::Unborn { name } => Some(name),
            Head::Detached => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    pub subject: String,
    pub committed_at: Utc,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchTip {
    pub sha: String,
    pub subject: String,
    pub committed_at: Utc,
    pub merged: bool,
    pub pushed: bool,
    pub local_commits: Count,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct LocalBranch {
    pub name: String,
    pub upstream: Option<Upstream>,
    pub tip: Option<BranchTip>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Stash {
    pub index: Count,
    pub message: String,
    pub sha: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeletedBranch {
    pub name: String,
    pub r#ref: String,
    pub sha: String,
    pub subject: String,
    pub deleted_at: Utc,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DroppedStash {
    pub r#ref: String,
    pub sha: String,
    pub message: String,
    pub dropped_at: Utc,
}

pub const DELETED_BRANCH_PREFIX: &str = "refs/fleetfrog/deleted/";
pub const DROPPED_STASH_PREFIX: &str = "refs/fleetfrog/stashes/";

/// When a dropped-stash ref (`refs/fleetfrog/stashes/<millis>/<index>`) was dropped.
pub fn parse_dropped_stash_ref(r#ref: &str) -> Option<i64> {
    let rest = r#ref.strip_prefix(DROPPED_STASH_PREFIX)?;
    let (millis, index) = rest.split_once('/')?;
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());

    (digits(millis) && digits(index)).then(|| millis.parse().ok())?
}

/// The branch a deleted-branch ref (`refs/fleetfrog/deleted/<millis>/<name>`) keeps, and when.
pub fn parse_deleted_ref(r#ref: &str) -> Option<(String, i64)> {
    let rest = r#ref.strip_prefix(DELETED_BRANCH_PREFIX)?;
    let (millis, name) = rest.split_once('/')?;

    if millis.is_empty()
        || !millis.bytes().all(|byte| byte.is_ascii_digit())
        || name.is_empty()
        || name.contains('\n')
    {
        return None;
    }

    Some((name.to_string(), millis.parse().ok()?))
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorktreeState {
    Present,
    Missing,
    Broken,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct LinkedWorktree {
    pub path: String,
    pub branch: Option<String>,
    pub state: WorktreeState,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub head: Head,
    pub operation: Option<Operation>,
    pub last_commit: Option<Commit>,
    pub changed: Capped<ChangedFile>,
    pub untracked: Capped<String>,
    pub stashes: Capped<Stash>,
    pub branches: Capped<LocalBranch>,
    pub default_branch: Option<String>,
    pub deleted_branches: Capped<DeletedBranch>,
    pub dropped_stashes: Capped<DroppedStash>,
    pub worktrees: Vec<LinkedWorktree>,
    pub last_fetched_at: Option<Utc>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct MergedPullRequest {
    pub number: Count,
    pub url: String,
    pub branch: String,
    pub sha: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct PullRequest {
    pub number: Count,
    pub title: String,
    pub url: String,
    pub branch: String,
    pub draft: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubState {
    pub default_branch: String,
    pub remote_sha: String,
    pub tracking_sha: Option<String>,
    pub pull_requests: Vec<PullRequest>,
    pub merged_pull_requests: Vec<MergedPullRequest>,
    pub checked_at: Utc,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag")]
pub enum CheckoutStatus {
    Read { git: Box<GitStatus> },
    Failed { message: String },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag", rename_all_fields = "camelCase")]
pub enum Worktree {
    Main,
    Linked { main_path: String },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag", rename_all_fields = "camelCase")]
pub enum Placement {
    Projects,
    Archive {
        original_path: Option<String>,
        archived_at: Option<Utc>,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Checkout {
    pub path: String,
    pub identity: RepositoryIdentity,
    pub origin_url: Option<String>,
    pub directory_name: String,
    pub worktree: Worktree,
    pub placement: Placement,
    pub status: CheckoutStatus,
    pub github: Option<GithubState>,
    pub scanned_at: Utc,
}

// Trash and inspection.

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashedWorktree {
    pub original_path: String,
    pub trashed_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashedCheckout {
    pub id: String,
    pub original_path: String,
    pub identity: RepositoryIdentity,
    pub directory_name: String,
    pub branch: Option<String>,
    pub last_commit: Option<Commit>,
    pub trashed_at: Utc,
    pub size_bytes: Count,
    #[serde(default)]
    pub worktrees: Vec<TrashedWorktree>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SizedPath {
    pub path: String,
    pub size_bytes: Count,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag")]
pub enum RemoteCheck {
    Fetched,
    NoRemote,
    Unreachable { message: String },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct UnpushedBranch {
    pub name: String,
    pub commits: Count,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub fingerprint: String,
    pub size_bytes: Count,
    pub remote: RemoteCheck,
    pub unpushed_branches: Vec<UnpushedBranch>,
    pub unpushed_commits: Count,
    pub unpushed_tags: Count,
    pub operation: Option<Operation>,
    pub submodules: Count,
    pub stashes: Count,
    pub changed_files: Count,
    pub untracked_files: Count,
    pub ignored: Capped<SizedPath>,
    pub caches: Vec<SizedPath>,
    pub linked_worktrees: Count,
}

impl Inspection {
    /// Whether everything in the checkout can be had again from its remotes or rebuilt.
    pub fn nothing_unique(&self) -> bool {
        self.remote == RemoteCheck::Fetched
            && self.unpushed_commits == 0
            && self.unpushed_tags == 0
            && self.operation.is_none()
            && self.submodules == 0
            && self.stashes == 0
            && self.changed_files == 0
            && self.untracked_files == 0
            && self.ignored.total == 0
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissingWorktree {
    pub parent_missing: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInspection {
    pub fingerprint: String,
    pub path: String,
    pub missing: Option<MissingWorktree>,
    pub branch: Option<String>,
    pub locked: Option<String>,
    pub changed_files: Count,
    pub untracked_files: Count,
    pub unreachable_commits: Count,
    pub ignored: Capped<SizedPath>,
    pub caches: Vec<SizedPath>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "_tag")]
pub enum InspectionResult {
    Inspected { inspection: Inspection },
    WorktreeInspected { inspection: WorktreeInspection },
    Failed { message: String },
}

// Folders.

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag")]
pub enum FolderOutcome {
    Created,
    AlreadyThere,
    Failed { message: String },
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum FolderStatus {
    Folder,
    Missing,
    NotFolder,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ReportedRoot {
    pub path: String,
    pub status: FolderStatus,
}

// Machines.

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "_tag")]
pub enum GithubCli {
    Available { login: String },
    Unavailable { reason: String },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct MachineModel {
    pub name: String,
    pub detail: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Cpu {
    pub model: String,
    pub cores: Count,
}

#[derive(Serialize, Clone, Debug)]
pub struct Versions {
    pub node: Option<String>,
    pub git: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: String,
    pub model: Option<MachineModel>,
    pub kind: Option<&'static str>,
    pub hypervisor: Option<String>,
    pub architecture: String,
    pub cpu: Cpu,
    pub memory_bytes: u64,
    pub booted_at: Utc,
    pub versions: Versions,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    pub total_bytes: u64,
    pub free_bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemUsage {
    pub disk: Option<Disk>,
    pub memory_used_bytes: Option<u64>,
    pub load_average: [f64; 3],
    pub sampled_at: Utc,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MachineInfo {
    pub hostname: String,
    pub pretty_name: Option<String>,
    pub platform: &'static str,
    pub home_directory: String,
    pub agent_version: String,
    pub agent_runtime: &'static str,
    pub github_cli: GithubCli,
    pub system: Option<SystemInfo>,
}

// T3 Code.

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct T3CodeSchema {
    pub migration: i64,
    pub name: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag")]
pub enum ProjectIcon {
    Lucide { name: String, color: String },
    Emoji { emoji: String },
    Monogram { text: String, color: String },
    Image { id: String },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct T3CodeProject {
    pub id: String,
    pub title: String,
    pub path: String,
    pub icon: Option<ProjectIcon>,
    pub auto_pull: bool,
    pub updated_at: Utc,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum T3CodeThreadState {
    Working,
    Waiting,
    Idle,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct T3CodeThread {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub path: String,
    pub worktree: bool,
    pub state: T3CodeThreadState,
    pub archived: bool,
    pub updated_at: Utc,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "_tag", rename_all_fields = "camelCase")]
pub enum T3CodeReading {
    NotFound,
    Unreadable {
        message: String,
        schema: Option<T3CodeSchema>,
    },
    Read {
        schema: T3CodeSchema,
        projects: Vec<T3CodeProject>,
        threads: Vec<T3CodeThread>,
        thread_count: Count,
        unread_records: Count,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct T3CodeServer {
    pub version: Option<String>,
    pub started_at: Utc,
    pub port: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct T3CodeProvider {
    pub name: String,
    pub version: Option<String>,
    pub latest_version: Option<String>,
    pub ready: bool,
    pub signed_in: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct T3CodeStatus {
    pub database: String,
    pub reading: T3CodeReading,
    pub server: Option<T3CodeServer>,
    pub providers: Vec<T3CodeProvider>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconFile {
    pub id: String,
    pub media_type: &'static str,
    pub base64: String,
}

// Hub commands and reports.

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSchedule {
    pub status_seconds: u64,
    pub discovery_seconds: u64,
    pub github_seconds: u64,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct T3CodeAgentSettings {
    pub discover_projects: bool,
    pub project_icons: bool,
}

#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    pub discovery_roots: Vec<String>,
    pub schedule: AgentSchedule,
    #[serde(default)]
    pub archive_folder: Option<String>,
    #[serde(default)]
    pub t3_code: Option<T3CodeAgentSettings>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "_tag", rename_all_fields = "camelCase")]
pub enum HubCommand {
    Configure(Configuration),
    Refresh {},
    RunAction {
        run_id: String,
        request: ActionRequest,
    },
    CancelAction {
        run_id: String,
    },
    CreateFolder {
        request_id: String,
        path: String,
    },
    Inspect {
        request_id: String,
        path: String,
        #[serde(default)]
        worktree: Option<String>,
    },
    /// Replaces the agent with the release of `version`, the hub's own, then restarts on it.
    Update {
        version: String,
    },
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "_tag", rename_all_fields = "camelCase")]
pub enum ScanReport {
    Discovery {
        checkouts: Vec<Checkout>,
        roots: Vec<ReportedRoot>,
        completed_at: Utc,
    },
    Trash {
        items: Vec<TrashedCheckout>,
    },
    T3Code {
        status: T3CodeStatus,
    },
    ProjectIcons {
        icons: Vec<ProjectIconFile>,
    },
    Status {
        changed: Vec<Checkout>,
        removed_paths: Vec<String>,
        completed_at: Utc,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn encodes_tagged_unions_as_effect_does() {
        let outcome = succeeded(ActionResult::Switched {
            branch: "main".into(),
            stashed_files: 1,
            saved_commits: 0,
        });

        assert_eq!(
            serde_json::to_value(outcome).unwrap(),
            json!({"_tag": "Succeeded", "result": {"_tag": "Switched", "branch": "main", "stashedFiles": 1, "savedCommits": 0}})
        );
        assert_eq!(
            serde_json::to_value(skipped(SkipReason::OperationInProgress {
                operation: Operation::CherryPick
            }))
            .unwrap(),
            json!({"_tag": "Skipped", "reason": {"_tag": "OperationInProgress", "operation": "cherry-pick"}})
        );
        assert_eq!(
            serde_json::to_value(SkipReason::Detached).unwrap(),
            json!({"_tag": "Detached"})
        );
    }

    #[test]
    fn decodes_commands_with_their_defaults() {
        let command: HubCommand = serde_json::from_value(json!({
            "_tag": "RunAction",
            "runId": "r",
            "request": {"_tag": "Switch", "path": "/p", "branch": "b"}
        }))
        .unwrap();

        match command {
            HubCommand::RunAction {
                request: ActionRequest::Switch { stash_changes, .. },
                ..
            } => assert!(!stash_changes),
            other => panic!("unexpected {other:?}"),
        }

        let configure: HubCommand = serde_json::from_value(json!({
            "_tag": "Configure",
            "discoveryRoots": ["~/Projects"],
            "schedule": {"statusSeconds": 30, "discoverySeconds": 1800, "githubSeconds": 900},
            "t3Code": {"discoverProjects": true, "projectIcons": false}
        }))
        .unwrap();

        match configure {
            HubCommand::Configure(configuration) => {
                assert_eq!(configuration.archive_folder, None);
                assert_eq!(
                    configuration.t3_code,
                    Some(T3CodeAgentSettings {
                        discover_projects: true,
                        project_icons: false
                    })
                );
            }
            other => panic!("unexpected {other:?}"),
        }

        let restore: ActionRequest = serde_json::from_value(
            json!({"_tag": "Restore", "target": {"_tag": "Branch", "path": "/p", "ref": "refs/x"}}),
        )
        .unwrap();

        assert_eq!(
            restore,
            ActionRequest::Restore {
                target: TrashTarget::Branch {
                    path: "/p".into(),
                    r#ref: "refs/x".into()
                }
            }
        );
        assert!(serde_json::from_value::<HubCommand>(json!({"_tag": "Refresh"})).is_ok());
    }

    #[test]
    fn refuses_trash_ids_that_are_not_uuids() {
        let purge = |id: &str| ActionRequest::Purge {
            target: TrashTarget::Checkout { id: id.into() },
        };

        assert!(purge("0f8fad5b-d9cb-469f-a165-70867728950e").is_valid());
        assert!(!purge("../../Projects").is_valid());
    }

    #[test]
    fn parses_fleetfrog_refs() {
        assert_eq!(
            parse_deleted_ref("refs/fleetfrog/deleted/17/feature/x"),
            Some(("feature/x".into(), 17))
        );
        assert_eq!(parse_deleted_ref("refs/fleetfrog/deleted/x/y"), None);
        assert_eq!(
            parse_dropped_stash_ref("refs/fleetfrog/stashes/17/2"),
            Some(17)
        );
        assert_eq!(parse_dropped_stash_ref("refs/fleetfrog/stashes/17/a"), None);
    }
}
