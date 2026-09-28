//! Discovers and reads this machine's checkouts, and turns each pass into a report for the hub.
//! Passes never overlap.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use futures_util::stream;
use serde_json::json;
use tokio::sync::watch;

use crate::actions::archive::Folders;
use crate::discovery::{archive_path, discover_checkouts, repository_checkouts, root_path};
use crate::git::{self, CheckoutLocation};
use crate::github::GithubReader;
use crate::hub::rpc::HubClient;
use crate::protocol::{
    Checkout, CheckoutStatus, FolderStatus, Placement, ReportedRoot, ScanReport,
    T3CodeAgentSettings, T3CodeReading,
};
use crate::store;
use crate::t3code::{self, Favicons, T3CodeRead};
use crate::time::Utc;

const READ_CONCURRENCY: usize = 4;

#[derive(Clone, Copy)]
pub enum PassKind {
    Discovery,
    Status,
}

#[derive(Default)]
struct State {
    /// Numbers requests and pass starts in the order they happen, so no two compare as equal.
    sequence: u64,
    /// The number each kind of pass last started at.
    started_discovery: u64,
    started_status: u64,
    locations: Vec<CheckoutLocation>,
    /// Each checkout's content as last reported, by path.
    sent: HashMap<String, String>,
    /// What was last sent about T3 Code, so an unchanged reading isn't resent every pass.
    sent_t3code: Option<String>,
    /// The icon hashes last sent, so their images are only resent when the set changes.
    sent_icons: Option<String>,
}

pub struct Scanner {
    client: Arc<HubClient>,
    github: Option<GithubReader>,
    trash_directory: String,
    /// The project folders and Archive folder the hub last configured.
    folders: Arc<Mutex<Folders>>,
    t3code_database: String,
    /// Held for the length of each pass, and by the actions' rescans.
    pass: tokio::sync::Mutex<Favicons>,
    state: Mutex<State>,
    /// True once the first discovery walk has found the checkouts, so they can be located.
    first_walk: watch::Sender<bool>,
}

/// A checkout's content with its timestamps blanked, so unchanged checkouts are not resent.
fn content_key(checkout: &Checkout) -> String {
    let mut blank = checkout.clone();

    blank.scanned_at = Utc::EPOCH;

    if let Some(github) = &mut blank.github {
        github.checked_at = Utc::EPOCH;
    }

    serde_json::to_string(&blank).expect("checkouts encode as JSON")
}

/// What is at each discovery folder and the Archive folder, so the dashboard can point out a
/// mistyped or missing one.
fn inspect_roots(roots: &[String]) -> Vec<ReportedRoot> {
    roots
        .iter()
        .map(|root| ReportedRoot {
            path: root.clone(),
            status: match std::fs::metadata(root_path(root)) {
                Ok(found) if found.is_dir() => FolderStatus::Folder,
                Ok(_) => FolderStatus::NotFolder,
                Err(_) => FolderStatus::Missing,
            },
        })
        .collect()
}

impl Scanner {
    pub fn new(
        client: Arc<HubClient>,
        github_login: Option<String>,
        trash_directory: String,
        folders: Arc<Mutex<Folders>>,
    ) -> Scanner {
        Scanner {
            client,
            github: github_login.map(GithubReader::new),
            trash_directory,
            folders,
            t3code_database: t3code::database_path(),
            pass: tokio::sync::Mutex::new(Favicons::new()),
            state: Mutex::new(State::default()),
            first_walk: watch::channel(false).0,
        }
    }

    async fn report(&self, report: ScanReport) -> Result<(), String> {
        self.client
            .call("Report", Some(json!({ "report": report })))
            .await
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub async fn report_trash(&self) -> Result<(), String> {
        let trash = self.trash_directory.clone();
        // A listing that failed isn't an empty trash, which would clear what the hub holds.
        let items = tokio::task::spawn_blocking(move || store::list_trash(&trash))
            .await
            .map_err(|error| format!("Couldn't list the trash: {error}"))?;

        self.report(ScanReport::Trash { items }).await
    }

    async fn read_integration(
        &self,
        settings: Option<T3CodeAgentSettings>,
        favicons: &mut Favicons,
    ) -> Option<T3CodeRead> {
        Some(t3code::read_t3code(&self.t3code_database, settings?.project_icons, favicons).await)
    }

    async fn report_integration(&self, read: Option<T3CodeRead>) -> Result<(), String> {
        let Some(read) = read else {
            return Ok(());
        };
        let status = serde_json::to_string(&read.status).expect("T3 Code's status encodes as JSON");

        if self.state.lock().unwrap().sent_t3code.as_ref() != Some(&status) {
            self.report(ScanReport::T3Code {
                status: read.status,
            })
            .await?;
            self.state.lock().unwrap().sent_t3code = Some(status);
        }

        let mut ids: Vec<&str> = read.icons.iter().map(|icon| icon.id.as_str()).collect();

        ids.sort_unstable();

        let icons = ids.join(",");

        if self.state.lock().unwrap().sent_icons.as_ref() != Some(&icons) {
            self.report(ScanReport::ProjectIcons { icons: read.icons })
                .await?;
            self.state.lock().unwrap().sent_icons = Some(icons);
        }

        Ok(())
    }

    async fn read_checkout(
        &self,
        location: &CheckoutLocation,
        github_maximum_age: Duration,
    ) -> Checkout {
        let git = git::read_git_status(location).await;
        // Archived checkouts don't need GitHub's view, which costs a request per repository.
        let github = match (&self.github, &git) {
            (Some(reader), Ok(status)) if location.placement == Placement::Projects => {
                let branches: Vec<String> = status
                    .branches
                    .items
                    .iter()
                    .map(|branch| branch.name.clone())
                    .collect();

                reader.read(location, &branches, github_maximum_age).await
            }
            _ => None,
        };

        Checkout {
            path: location.path.clone(),
            identity: location.identity.clone(),
            origin_url: location.origin_url.clone(),
            directory_name: location.directory_name.clone(),
            worktree: location.worktree.clone(),
            placement: location.placement.clone(),
            status: match git {
                Ok(status) => CheckoutStatus::Read {
                    git: Box::new(status),
                },
                Err(error) => CheckoutStatus::Failed {
                    message: error.message,
                },
            },
            github,
            scanned_at: Utc::now(),
        }
    }

    async fn read_all(
        &self,
        targets: &[CheckoutLocation],
        github_maximum_age: Duration,
    ) -> Vec<Checkout> {
        stream::iter(targets.to_vec())
            .map(|location| async move { self.read_checkout(&location, github_maximum_age).await })
            .buffered(READ_CONCURRENCY)
            .collect()
            .await
    }

    /// Reports rereads that changed since they were last sent, and checkouts that went.
    async fn report_changed(
        &self,
        checkouts: Vec<Checkout>,
        removed_paths: Vec<String>,
    ) -> Result<(), String> {
        let changed: Vec<Checkout> = {
            let state = self.state.lock().unwrap();

            checkouts
                .into_iter()
                .filter(|checkout| state.sent.get(&checkout.path) != Some(&content_key(checkout)))
                .collect()
        };

        if changed.is_empty() && removed_paths.is_empty() {
            return Ok(());
        }

        let keys: Vec<(String, String)> = changed
            .iter()
            .map(|checkout| (checkout.path.clone(), content_key(checkout)))
            .collect();

        self.report(ScanReport::Status {
            changed,
            removed_paths: removed_paths.clone(),
            completed_at: Utc::now(),
        })
        .await?;

        // Only a delivered report retires checkouts that went, so a failed one leaves them for the
        // next status pass, which finds them gone.
        let mut state = self.state.lock().unwrap();

        state
            .locations
            .retain(|location| !removed_paths.contains(&location.path));

        for path in &removed_paths {
            state.sent.remove(path);
        }

        state.sent.extend(keys);

        Ok(())
    }

    /// Takes the pass lock, unless a pass of this kind started after the request, which has
    /// already covered it. A burst of requests collapses into one pass.
    async fn begin(&self, kind: PassKind) -> Option<tokio::sync::MutexGuard<'_, Favicons>> {
        let requested = {
            let mut state = self.state.lock().unwrap();

            state.sequence += 1;
            state.sequence
        };
        let guard = self.pass.lock().await;
        let mut state = self.state.lock().unwrap();
        let State {
            sequence,
            started_discovery,
            started_status,
            ..
        } = &mut *state;
        let started = match kind {
            PassKind::Discovery => started_discovery,
            PassKind::Status => started_status,
        };

        if *started > requested {
            return None;
        }

        *sequence += 1;
        *started = *sequence;

        Some(guard)
    }

    /// Walks the roots and the Archive folder, reads every checkout found and replaces the hub's
    /// inventory.
    pub async fn discover(
        &self,
        roots: &[String],
        archive_folder: Option<&str>,
        github_maximum_age: Duration,
        t3code: Option<T3CodeAgentSettings>,
    ) -> Result<(), String> {
        let Some(mut favicons) = self.begin(PassKind::Discovery).await else {
            return Ok(());
        };

        favicons.clear();

        let integration = self.read_integration(t3code, &mut favicons).await;
        let project_folders: Vec<String> = match (&t3code, &integration) {
            (Some(settings), Some(read)) if settings.discover_projects => {
                match &read.status.reading {
                    T3CodeReading::Read { projects, .. } => projects
                        .iter()
                        .map(|project| project.path.clone())
                        .collect(),
                    _ => Vec::new(),
                }
            }
            _ => Vec::new(),
        };
        let found = discover_checkouts(roots, archive_folder, &project_folders).await;

        // Actions can find the checkouts at once, while their status is still being read.
        self.state.lock().unwrap().locations = found.clone();
        self.first_walk.send_replace(true);

        let checkouts = self.read_all(&found, github_maximum_age).await;
        let mut reported_roots = roots.to_vec();

        reported_roots.extend(archive_folder.map(String::from));

        let keys: HashMap<String, String> = checkouts
            .iter()
            .map(|checkout| (checkout.path.clone(), content_key(checkout)))
            .collect();

        self.report(ScanReport::Discovery {
            checkouts,
            roots: inspect_roots(&reported_roots),
            completed_at: Utc::now(),
        })
        .await?;
        self.report_trash().await?;
        self.report_integration(integration).await?;
        self.state.lock().unwrap().sent = keys;

        Ok(())
    }

    /// Rereads known checkouts and reports only those that changed or disappeared. Archived
    /// checkouts are only checked for, since nothing works on them.
    pub async fn status(
        &self,
        github_maximum_age: Duration,
        t3code: Option<T3CodeAgentSettings>,
    ) -> Result<(), String> {
        let Some(mut favicons) = self.begin(PassKind::Status).await else {
            return Ok(());
        };
        let locations = self.state.lock().unwrap().locations.clone();
        let (present, removed): (Vec<CheckoutLocation>, Vec<CheckoutLocation>) = locations
            .into_iter()
            .partition(|location| std::path::Path::new(&location.path).exists());
        let removed_paths: Vec<String> =
            removed.into_iter().map(|location| location.path).collect();
        let active: Vec<CheckoutLocation> = present
            .iter()
            .filter(|location| location.placement == Placement::Projects)
            .cloned()
            .collect();
        let checkouts = self.read_all(&active, github_maximum_age).await;
        let changed: Vec<Checkout> = {
            let state = self.state.lock().unwrap();

            checkouts
                .into_iter()
                .filter(|checkout| state.sent.get(&checkout.path) != Some(&content_key(checkout)))
                .collect()
        };
        let keys: Vec<(String, String)> = changed
            .iter()
            .map(|checkout| (checkout.path.clone(), content_key(checkout)))
            .collect();

        self.report(ScanReport::Status {
            changed,
            removed_paths: removed_paths.clone(),
            completed_at: Utc::now(),
        })
        .await?;

        // Only a delivered report retires removed checkouts, so a failed one is retried next pass.
        {
            let mut state = self.state.lock().unwrap();

            state.locations = present;

            for path in &removed_paths {
                state.sent.remove(path);
            }

            state.sent.extend(keys);
        }

        let integration = self.read_integration(t3code, &mut favicons).await;

        self.report_integration(integration).await
    }

    /// Waits until the first discovery walk has found the checkouts.
    pub async fn discovered(&self) {
        let mut receiver = self.first_walk.subscribe();
        let _ = receiver.wait_for(|found| *found).await;
    }

    /// The checkout at `path` from the last discovery walk, if any.
    pub fn locate(&self, path: &str) -> Option<CheckoutLocation> {
        self.state
            .lock()
            .unwrap()
            .locations
            .iter()
            .find(|location| location.path == path)
            .cloned()
    }

    /// Rereads every worktree of one repository after an action changed it, asking GitHub again so
    /// its default branch compares against what was just fetched.
    pub async fn rescan_repository(&self, common_directory: &str) -> Result<(), String> {
        let _pass = self.pass.lock().await;
        let targets: Vec<CheckoutLocation> = self
            .state
            .lock()
            .unwrap()
            .locations
            .iter()
            .filter(|location| location.common_directory == common_directory)
            .cloned()
            .collect();
        let checkouts = self.read_all(&targets, Duration::ZERO).await;

        self.report_changed(checkouts, Vec::new()).await
    }

    /// Follows a repository whose checkouts moved, arrived or went, as archiving, trashing,
    /// restoring, deleting, cloning and removing a worktree do. Drops the checkouts of the
    /// repository whose Git directory was `left`, and reads the main checkout at `main` with its
    /// linked worktrees wherever they are now. Both go in one report, so the hub never holds the
    /// repository half moved.
    pub async fn follow_repository(
        &self,
        left: Option<&str>,
        main: Option<&str>,
    ) -> Result<(), String> {
        let _pass = self.pass.lock().await;
        let found = match main {
            None => Vec::new(),
            Some(main) => {
                let folders = self.folders.lock().unwrap().clone();
                let archive = archive_path(folders.archive_folder.as_deref(), &folders.roots);

                repository_checkouts(main, archive.as_deref()).await
            }
        };
        let removed_paths: Vec<String> = {
            let mut state = self.state.lock().unwrap();
            let removed_paths = state
                .locations
                .iter()
                .filter(|known| Some(known.common_directory.as_str()) == left)
                .filter(|known| !found.iter().any(|location| location.path == known.path))
                .map(|known| known.path.clone())
                .collect();

            for location in &found {
                match state
                    .locations
                    .iter_mut()
                    .find(|known| known.path == location.path)
                {
                    Some(known) => *known = location.clone(),
                    None => state.locations.push(location.clone()),
                }
            }

            removed_paths
        };
        let checkouts = self.read_all(&found, Duration::ZERO).await;

        self.report_changed(checkouts, removed_paths).await
    }
}
