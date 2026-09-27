//! Runs the hub's action requests on this machine. Each action is checked against the owner's
//! policy when it arrives, waits for any other action on the same repository and, if it uses the
//! network, for a network slot, then reports its progress and outcome. Every step is recorded in
//! the audit log.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use std::panic::AssertUnwindSafe;

use futures_util::FutureExt;
use serde_json::json;
use tokio::sync::Semaphore;

use crate::audit::{self, AuditEntry};
use crate::config::load_policy;
use crate::git::CheckoutLocation;
use crate::hub::rpc::HubClient;
use crate::inspect::{Fetch, inspect_checkout, inspect_worktree};
use crate::output::ActionOutput;
use crate::paths::{self, DestinationCheck};
use crate::process::{Cancel, GitError};
use crate::protocol::{
    ActionOutcome, ActionRequest, ActionResult, ActionUpdate, BranchAtCommit, InspectionResult,
    Placement, SkipReason, StashAtCommit, Tier, TrashTarget, failed, skipped,
};
use crate::scanner::Scanner;

use super::archive::{Folders, archive_checkout, unarchive_checkout};
use super::git_actions::{
    clone_repository, delete_branches, destination_problem, fetch_repository, pull_checkout,
    purge_branch, restore_branch, stash_changes, switch_branch,
};
use super::stashes::{drop_stashes, purge_stash, restore_stash};
use super::trash::{delete_checkout, purge_checkout, restore_checkout, trash_checkout};
use super::worktree::remove_worktree;
use super::{Context, Interrupted, settle};

/// Fetches and clones that may use the network at once.
const NETWORK_CONCURRENCY: usize = 4;
/// How long a request waits for the agent's first discovery walk after it starts, which a slow or
/// busy machine can take a while over. It stays under the hub's wait for an inspection.
const DISCOVERY_WAIT: Duration = Duration::from_secs(120);
const NOT_DISCOVERED: &str = "This machine's agent hasn't finished finding its checkouts since it started. Try again once it has.";
const PROGRESS_INTERVAL: Duration = Duration::from_secs(1);

/// An action resolved against this machine.
enum Work {
    Fetch(CheckoutLocation),
    Pull(CheckoutLocation),
    Switch(CheckoutLocation, String, bool),
    Stash(CheckoutLocation),
    DeleteBranches(CheckoutLocation, Vec<BranchAtCommit>),
    DropStashes(CheckoutLocation, Vec<StashAtCommit>),
    RestoreBranch(CheckoutLocation, String),
    PurgeBranch(CheckoutLocation, String),
    RestoreStash(CheckoutLocation, String),
    PurgeStash(CheckoutLocation, String),
    Archive(CheckoutLocation),
    Unarchive(CheckoutLocation),
    RemoveWorktree {
        path: String,
        common_directory: String,
        worktree: String,
        fingerprint: String,
    },
    Trash {
        location: CheckoutLocation,
        fingerprint: String,
        remove_caches: bool,
    },
    Delete {
        location: CheckoutLocation,
        fingerprint: String,
        discard_unique_work: bool,
    },
    RestoreCheckout(String),
    PurgeCheckout(String),
    Clone {
        url: String,
        path: String,
        root: String,
        archive: Option<String>,
    },
}

#[allow(
    clippy::large_enum_variant,
    reason = "a plan lives only while its action starts"
)]
enum Plan {
    /// Nothing on this machine matches the request, so it can't run at all.
    Refused(String),
    Ready {
        lock_key: String,
        network: bool,
        work: Work,
    },
}

struct Run {
    cancel: Cancel,
    /// Set when the owner cancelled it, rather than the connection ending.
    by_owner: Arc<AtomicBool>,
}

struct Shared {
    scanner: Arc<Scanner>,
    client: Arc<HubClient>,
    folders: Arc<Mutex<Folders>>,
    trash_directory: String,
    home: String,
    slots: Arc<Semaphore>,
    repository_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    runs: Mutex<HashMap<String, Run>>,
    /// Cancelled when the session ends, which interrupts queued and cancellable work.
    ending: Cancel,
}

#[derive(Clone)]
pub struct ActionRunner(Arc<Shared>);

/// Why the owner's policy refuses the tier now, as the reason to log and the outcome to report,
/// or None when it allows it. An unreadable policy allows nothing, and says so.
fn policy_refusal(tier: Tier) -> Option<(String, ActionOutcome)> {
    match load_policy() {
        Ok(policy) if policy.allows(tier) => None,
        Ok(_) => Some((
            format!("The {} tier is not allowed", tier.as_str()),
            skipped(SkipReason::NotAllowed { tier }),
        )),
        Err(error) => {
            let message = format!(
                "This machine's policy can't be read, so it allows nothing: {}",
                error.message
            );

            Some((message.clone(), failed(message)))
        }
    }
}

/// An inspection fetches only when the owner allows Git actions, which cover fetching.
fn inspection_fetch() -> Fetch {
    if load_policy().is_ok_and(|policy| policy.allows(Tier::Git)) {
        Fetch::Allowed
    } else {
        Fetch::NotAllowed
    }
}

/// Waits for `future` unless `cancel` fires first, which wins when both are ready.
async fn unless_cancelled<T>(cancel: &Cancel, future: impl Future<Output = T>) -> Option<T> {
    tokio::select! {
        biased;
        () = cancel.cancelled() => None,
        value = future => Some(value),
    }
}

/// The description of a panic, for an outcome the hub can show.
fn panic_message(panic: &(dyn std::any::Any + Send)) -> String {
    panic
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            panic
                .downcast_ref::<&str>()
                .map(|message| message.to_string())
        })
        .unwrap_or_else(|| "a panic".into())
}

impl ActionRunner {
    pub fn new(
        scanner: Arc<Scanner>,
        client: Arc<HubClient>,
        folders: Arc<Mutex<Folders>>,
        trash_directory: String,
    ) -> ActionRunner {
        ActionRunner(Arc::new(Shared {
            scanner,
            client,
            folders,
            trash_directory,
            home: paths::home(),
            slots: Arc::new(Semaphore::new(NETWORK_CONCURRENCY)),
            repository_locks: Mutex::new(HashMap::new()),
            runs: Mutex::new(HashMap::new()),
            ending: Cancel::new(),
        }))
    }

    fn lock_for(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.0
            .repository_locks
            .lock()
            .unwrap()
            .entry(key.to_string())
            .or_default()
            .clone()
    }

    async fn send(&self, run_id: &str, update: ActionUpdate) {
        if let Err(error) = self
            .0
            .client
            .call(
                "ReportAction",
                Some(json!({ "runId": run_id, "update": update })),
            )
            .await
        {
            crate::log::warning("Could not report an action", error);
        }
    }

    async fn finish(&self, run_id: &str, outcome: ActionOutcome, output: Vec<String>) {
        audit::write(AuditEntry::ActionFinished {
            run_id: run_id.to_string(),
            outcome: outcome.clone(),
        });
        self.send(run_id, ActionUpdate::Finished { outcome, output })
            .await;
    }

    /// Reports a request the agent won't run. Nothing has changed, so no outcome is logged twice.
    async fn refuse(
        &self,
        run_id: &str,
        request: &ActionRequest,
        reason: String,
        outcome: ActionOutcome,
    ) {
        audit::write(AuditEntry::ActionRefused {
            run_id: run_id.to_string(),
            request: request.clone(),
            reason,
        });
        self.send(
            run_id,
            ActionUpdate::Finished {
                outcome,
                output: Vec::new(),
            },
        )
        .await;
    }

    /// Waits for the first discovery walk, returning false if it takes too long.
    async fn wait_for_discovery(&self) -> bool {
        tokio::time::timeout(DISCOVERY_WAIT, self.0.scanner.discovered())
            .await
            .is_ok()
    }

    /// Where the main checkout at `path` is, found from the checkout itself or, when the agent
    /// doesn't list it, from its linked worktree at `worktree`, which shares its Git directory.
    fn main_location(&self, path: &str, worktree: &str) -> Option<(String, String)> {
        if let Some(main) = self.0.scanner.locate(path) {
            return Some((main.path, main.common_directory));
        }

        let linked = self.0.scanner.locate(worktree)?;

        (paths::dirname(&linked.common_directory) == path)
            .then(|| (path.to_string(), linked.common_directory))
    }

    fn plan(&self, request: &ActionRequest) -> Plan {
        let scanner = &self.0.scanner;
        let no_checkout =
            |path: &str| Plan::Refused(format!("This machine has no checkout at {path}."));
        let at_checkout =
            |path: &str, network: bool, work: fn(CheckoutLocation) -> Work| match scanner
                .locate(path)
            {
                None => no_checkout(path),
                // Worktrees share one repository, and Git locks it while fetching or merging.
                Some(location) => Plan::Ready {
                    lock_key: location.common_directory.clone(),
                    network,
                    work: work(location),
                },
            };
        let with_location =
            |path: &str, network: bool, work: &dyn Fn(CheckoutLocation) -> Work| match scanner
                .locate(path)
            {
                None => no_checkout(path),
                Some(location) => Plan::Ready {
                    lock_key: location.common_directory.clone(),
                    network,
                    work: work(location),
                },
            };
        let trash_item = |id: &str, work: Work| Plan::Ready {
            lock_key: format!("trash:{id}"),
            network: false,
            work,
        };

        match request {
            ActionRequest::Fetch { path } => at_checkout(path, true, Work::Fetch),
            ActionRequest::Pull { path } => at_checkout(path, true, Work::Pull),
            ActionRequest::Switch {
                path,
                branch,
                stash_changes,
            } => with_location(path, false, &|location| {
                Work::Switch(location, branch.clone(), *stash_changes)
            }),
            ActionRequest::Stash { path } => at_checkout(path, false, Work::Stash),
            ActionRequest::DeleteBranches { path, branches } => {
                with_location(path, false, &|location| {
                    Work::DeleteBranches(location, branches.clone())
                })
            }
            ActionRequest::DropStashes { path, stashes } => {
                with_location(path, false, &|location| {
                    Work::DropStashes(location, stashes.clone())
                })
            }
            ActionRequest::RemoveWorktree {
                path,
                worktree,
                fingerprint,
            } => match self.main_location(path, worktree) {
                None => no_checkout(path),
                Some((path, common_directory)) => Plan::Ready {
                    lock_key: common_directory.clone(),
                    network: false,
                    work: Work::RemoveWorktree {
                        path,
                        common_directory,
                        worktree: worktree.clone(),
                        fingerprint: fingerprint.clone(),
                    },
                },
            },
            ActionRequest::Archive { path } | ActionRequest::Unarchive { path } => {
                let archiving = matches!(request, ActionRequest::Archive { .. });

                match scanner.locate(path) {
                    Some(location)
                        if matches!(location.placement, Placement::Archive { .. }) != archiving =>
                    {
                        Plan::Ready {
                            lock_key: location.common_directory.clone(),
                            network: false,
                            work: if archiving {
                                Work::Archive(location)
                            } else {
                                Work::Unarchive(location)
                            },
                        }
                    }
                    _ => Plan::Refused(format!(
                        "This machine has no {}checkout at {path}.",
                        if archiving { "" } else { "archived " }
                    )),
                }
            }
            ActionRequest::Trash {
                path,
                fingerprint,
                remove_caches,
            } => with_location(path, false, &|location| Work::Trash {
                location,
                fingerprint: fingerprint.clone(),
                remove_caches: *remove_caches,
            }),
            // Unless unique work may go, deleting inspects the checkout again, fetching first.
            ActionRequest::Delete {
                path,
                fingerprint,
                discard_unique_work,
            } => with_location(path, !discard_unique_work, &|location| Work::Delete {
                location,
                fingerprint: fingerprint.clone(),
                discard_unique_work: *discard_unique_work,
            }),
            ActionRequest::Restore { target } | ActionRequest::Purge { target } => {
                let restoring = matches!(request, ActionRequest::Restore { .. });

                match target {
                    TrashTarget::Branch { path, r#ref } => {
                        with_location(path, false, &|location| {
                            if restoring {
                                Work::RestoreBranch(location, r#ref.clone())
                            } else {
                                Work::PurgeBranch(location, r#ref.clone())
                            }
                        })
                    }
                    TrashTarget::Stash { path, r#ref } => with_location(path, false, &|location| {
                        if restoring {
                            Work::RestoreStash(location, r#ref.clone())
                        } else {
                            Work::PurgeStash(location, r#ref.clone())
                        }
                    }),
                    TrashTarget::Checkout { id } => trash_item(
                        id,
                        if restoring {
                            Work::RestoreCheckout(id.clone())
                        } else {
                            Work::PurgeCheckout(id.clone())
                        },
                    ),
                }
            }
            ActionRequest::Clone { url, destination } => {
                let folders = self.0.folders.lock().unwrap().clone();
                let check = paths::check_clone_destination(
                    destination,
                    &self.0.home,
                    &folders.roots,
                    folders.archive_folder.as_deref(),
                );

                match check {
                    DestinationCheck::Valid { path, root } => Plan::Ready {
                        lock_key: format!("clone:{path}"),
                        network: true,
                        work: Work::Clone {
                            url: url.clone(),
                            path,
                            root,
                            archive: folders.archive_folder,
                        },
                    },
                    invalid => Plan::Refused(
                        destination_problem(&invalid)
                            .unwrap_or_default()
                            .to_string(),
                    ),
                }
            }
        }
    }

    /// Runs the planned work. Anything that moves, deletes or rewrites refs runs to the end once
    /// started, so its `cancel` is never cancelled.
    async fn perform(
        &self,
        work: &Work,
        context: &Context<'_>,
    ) -> Result<ActionOutcome, Interrupted> {
        let shared = &self.0;
        let folders = || shared.folders.lock().unwrap().clone();
        let result: Result<ActionOutcome, GitError> = match work {
            Work::Fetch(location) => fetch_repository(location, context).await,
            Work::Pull(location) => pull_checkout(location, context).await,
            Work::Switch(location, branch, stash) => {
                switch_branch(location, branch, *stash, context).await
            }
            Work::Stash(location) => stash_changes(location, context).await,
            Work::DeleteBranches(location, branches) => {
                delete_branches(location, branches, context).await
            }
            Work::DropStashes(location, stashes) => drop_stashes(location, stashes, context).await,
            Work::RestoreBranch(location, name) => restore_branch(location, name, context).await,
            Work::PurgeBranch(location, name) => purge_branch(location, name, context).await,
            Work::RestoreStash(location, name) => restore_stash(location, name, context).await,
            Work::PurgeStash(location, name) => purge_stash(location, name, context).await,
            Work::Archive(location) => {
                archive_checkout(location, &folders(), &shared.home, context).await
            }
            Work::Unarchive(location) => {
                unarchive_checkout(location, &folders(), &shared.home, context).await
            }
            Work::RemoveWorktree {
                path,
                common_directory,
                worktree,
                fingerprint,
            } => remove_worktree(path, common_directory, worktree, fingerprint, context).await,
            Work::Trash {
                location,
                fingerprint,
                remove_caches,
            } => {
                trash_checkout(
                    location,
                    fingerprint,
                    *remove_caches,
                    &shared.trash_directory,
                    context,
                )
                .await
            }
            Work::Delete {
                location,
                fingerprint,
                discard_unique_work,
            } => {
                delete_checkout(
                    location,
                    fingerprint,
                    *discard_unique_work,
                    inspection_fetch(),
                    context,
                )
                .await
            }
            Work::RestoreCheckout(id) => {
                restore_checkout(&shared.trash_directory, id, context).await
            }
            Work::PurgeCheckout(id) => purge_checkout(&shared.trash_directory, id, context).await,
            Work::Clone {
                url,
                path,
                root,
                archive,
            } => clone_repository(url, path, root, &shared.home, archive.as_deref(), context).await,
        };

        settle(result)
    }

    /// Brings the hub's view up to date after an action, before its outcome is reported.
    async fn afterwards(&self, work: &Work, outcome: &ActionOutcome) -> Result<(), String> {
        let scanner = &self.0.scanner;
        let result = match outcome {
            ActionOutcome::Succeeded { result } => Some(result),
            _ => None,
        };

        match work {
            Work::Archive(location) | Work::Unarchive(location) => match result {
                Some(
                    ActionResult::Archived { path, worktrees }
                    | ActionResult::Unarchived { path, worktrees },
                ) => {
                    // The main checkout goes first, so its worktrees are read once it's in its new
                    // place.
                    let mut moves = vec![(location.path.clone(), path.clone())];

                    moves.extend(
                        worktrees
                            .iter()
                            .map(|moved| (moved.from.clone(), moved.to.clone())),
                    );

                    for (from, _) in &moves {
                        scanner.forget(from).await?;
                    }

                    for (_, to) in &moves {
                        scanner.track(to).await?;
                    }

                    Ok(())
                }
                _ => scanner.rescan_repository(&location.common_directory).await,
            },
            Work::Trash { location, .. } | Work::Delete { location, .. } => match result {
                Some(_) => {
                    scanner.forget(&location.path).await?;
                    scanner.report_trash().await
                }
                None => scanner.rescan_repository(&location.common_directory).await,
            },
            Work::RemoveWorktree {
                common_directory,
                worktree,
                ..
            } => {
                if result.is_some() {
                    scanner.forget(worktree).await?;
                }

                scanner.rescan_repository(common_directory).await
            }
            Work::RestoreCheckout(_) | Work::PurgeCheckout(_) => {
                if let Some(ActionResult::Restored {
                    path: Some(path), ..
                }) = result
                {
                    scanner.track(path).await?;
                }

                scanner.report_trash().await
            }
            // Only a clone this agent made is added, so a refused one can't point it elsewhere.
            Work::Clone { path, .. } => match result {
                Some(_) => scanner.track(path).await,
                None => Ok(()),
            },
            Work::Fetch(location)
            | Work::Pull(location)
            | Work::Switch(location, ..)
            | Work::Stash(location)
            | Work::DeleteBranches(location, _)
            | Work::DropStashes(location, _)
            | Work::RestoreBranch(location, _)
            | Work::PurgeBranch(location, _)
            | Work::RestoreStash(location, _)
            | Work::PurgeStash(location, _) => {
                scanner.rescan_repository(&location.common_directory).await
            }
        }
    }

    /// Sends Git's latest progress line whenever it changes, at most once a second.
    async fn report_progress(&self, run_id: &str, output: &ActionOutput) {
        let mut reported: Option<String> = None;

        loop {
            if let Some(line) = output
                .progress()
                .filter(|line| Some(line) != reported.as_ref())
            {
                reported = Some(line.clone());
                self.send(run_id, ActionUpdate::Progress { line }).await;
            }

            tokio::time::sleep(PROGRESS_INTERVAL).await;
        }
    }

    /// A cancelled action says so. One stopped by a lost connection can't, so only the log knows.
    async fn interrupted(&self, run_id: &str, by_owner: &AtomicBool, output: &ActionOutput) {
        if by_owner.load(Ordering::SeqCst) {
            self.finish(run_id, ActionOutcome::Cancelled, output.tail())
                .await;
        } else {
            audit::write(AuditEntry::ActionInterrupted {
                run_id: run_id.to_string(),
            });
        }
    }

    /// Checks the policy, waits for the repository and any network slot it needs, checks the
    /// policy again in case the owner changed it meanwhile, then runs the action and reports it.
    async fn execute(
        &self,
        run_id: &str,
        request: &ActionRequest,
        cancel: &Cancel,
        by_owner: &AtomicBool,
    ) {
        let output = ActionOutput::new();
        let tier = request.tier();

        if let Some((reason, outcome)) = policy_refusal(tier) {
            return self.refuse(run_id, request, reason, outcome).await;
        }

        // Only a clone needs no checkout the agent has found.
        if !matches!(request, ActionRequest::Clone { .. }) {
            match unless_cancelled(cancel, self.wait_for_discovery()).await {
                None => return self.interrupted(run_id, by_owner, &output).await,
                Some(false) => {
                    return self
                        .refuse(
                            run_id,
                            request,
                            NOT_DISCOVERED.into(),
                            failed(NOT_DISCOVERED),
                        )
                        .await;
                }
                Some(true) => {}
            }
        }

        let (lock_key, network, work) = match self.plan(request) {
            Plan::Refused(message) => {
                return self
                    .refuse(run_id, request, message.clone(), failed(message))
                    .await;
            }
            Plan::Ready {
                lock_key,
                network,
                work,
            } => (lock_key, network, work),
        };
        // The repository lock is taken first, so a queued action never holds a network slot.
        let lock = self.lock_for(&lock_key);
        let Some(_repository) = unless_cancelled(cancel, lock.lock()).await else {
            return self.interrupted(run_id, by_owner, &output).await;
        };
        let _slot = if network {
            match unless_cancelled(cancel, self.0.slots.clone().acquire_owned()).await {
                None => return self.interrupted(run_id, by_owner, &output).await,
                Some(permit) => permit.ok(),
            }
        } else {
            None
        };

        if let Some((reason, outcome)) = policy_refusal(tier) {
            return self.refuse(run_id, request, reason, outcome).await;
        }

        self.send(run_id, ActionUpdate::Started).await;
        audit::write(AuditEntry::ActionStarted {
            run_id: run_id.to_string(),
            request: request.clone(),
        });

        // An action that can't stop part-way can still be stopped before it starts.
        if cancel.is_cancelled() {
            return self.interrupted(run_id, by_owner, &output).await;
        }

        let atomic = !matches!(work, Work::Fetch(_) | Work::Pull(_) | Work::Clone { .. });
        let never = Cancel::new();
        let context = Context {
            output: &output,
            cancel: if atomic { &never } else { cancel },
        };
        let performed = tokio::select! {
            performed = self.perform(&work, &context) => performed,
            _ = self.report_progress(run_id, &output) => unreachable!("progress reports never end"),
        };

        drop(_slot);
        drop(_repository);

        let Ok(outcome) = performed else {
            return self.interrupted(run_id, by_owner, &output).await;
        };

        // The rescan goes first, so the hub has the checkout's new state by the time it hears the
        // outcome. The outcome is sent even when the rescan fails or a cancel arrives during it.
        let rescan = AssertUnwindSafe(self.afterwards(&work, &outcome)).catch_unwind();

        match unless_cancelled(cancel, rescan).await {
            Some(Ok(Err(error))) => crate::log::warning("Could not rescan after an action", error),
            Some(Err(panic)) => {
                crate::log::error("Rescanning after an action crashed", panic_message(&*panic));
            }
            Some(Ok(Ok(()))) | None => {}
        }

        self.finish(run_id, outcome, output.tail()).await;
    }

    /// Starts an action, unless one with this run id is already running.
    pub fn run(&self, run_id: String, request: ActionRequest) {
        let cancel = self.0.ending.child();
        let by_owner = Arc::new(AtomicBool::new(false));

        {
            let mut runs = self.0.runs.lock().unwrap();

            if runs.contains_key(&run_id) {
                return;
            }

            runs.insert(
                run_id.clone(),
                Run {
                    cancel: cancel.clone(),
                    by_owner: by_owner.clone(),
                },
            );
        }

        let runner = self.clone();

        tokio::spawn(async move {
            let inner = runner.clone();
            let id = run_id.clone();
            // A crash still ends the run, so the hub never waits on it forever.
            let crashed =
                tokio::spawn(async move { inner.execute(&id, &request, &cancel, &by_owner).await })
                    .await;

            if let Err(error) = crashed
                && error.is_panic()
            {
                crate::log::error("An action crashed", &error);
                runner
                    .finish(
                        &run_id,
                        failed(format!("The agent hit an unexpected error: {error}")),
                        Vec::new(),
                    )
                    .await;
            }

            runner.0.runs.lock().unwrap().remove(&run_id);
        });
    }

    /// Stops a queued or running action, which then reports itself cancelled.
    pub fn cancel(&self, run_id: &str) {
        if let Some(run) = self.0.runs.lock().unwrap().get(run_id) {
            run.by_owner.store(true, Ordering::SeqCst);
            run.cancel.cancel();
        }
    }

    /// Interrupts every action at the end of a session and waits for those that can't stop
    /// part-way to finish.
    pub async fn shut_down(&self) {
        self.0.ending.cancel();

        while !self.0.runs.lock().unwrap().is_empty() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// Inspects a checkout for the hub, or one of its linked worktrees, if the owner allows cleanup
    /// actions. It waits for the repository like an action, and for a network slot when it
    /// fetches. Every problem becomes a failed result the dashboard can show, including a crash.
    pub async fn inspect(&self, path: &str, worktree: Option<&str>) -> InspectionResult {
        match AssertUnwindSafe(self.inspect_now(path, worktree))
            .catch_unwind()
            .await
        {
            Ok(result) => result,
            Err(panic) => InspectionResult::Failed {
                message: format!(
                    "The agent hit an unexpected error: {}",
                    panic_message(&*panic)
                ),
            },
        }
    }

    async fn inspect_now(&self, path: &str, worktree: Option<&str>) -> InspectionResult {
        let failed = |message: String| InspectionResult::Failed { message };
        let stop = &self.0.ending;
        let stopped = || failed("The inspection was stopped.".into());

        if policy_refusal(Tier::Cleanup).is_some() {
            return failed("Cleanup actions are turned off on this machine.".into());
        }

        match unless_cancelled(stop, self.wait_for_discovery()).await {
            None => return stopped(),
            Some(false) => return failed(NOT_DISCOVERED.into()),
            Some(true) => {}
        }

        let no_checkout = || failed(format!("This machine has no checkout at {path}."));

        if let Some(worktree) = worktree {
            let Some((main_path, common_directory)) = self.main_location(path, worktree) else {
                return no_checkout();
            };
            let lock = self.lock_for(&common_directory);
            let Some(_repository) = unless_cancelled(stop, lock.lock()).await else {
                return stopped();
            };

            return match inspect_worktree(&main_path, &common_directory, worktree, stop).await {
                Ok(Some(inspection)) => InspectionResult::WorktreeInspected { inspection },
                Ok(None) => failed(format!(
                    "{worktree} is no longer one of this checkout's worktrees."
                )),
                Err(GitError::Failed(message)) => failed(message),
                Err(GitError::Interrupted) => stopped(),
            };
        }

        let Some(location) = self.0.scanner.locate(path) else {
            return no_checkout();
        };
        let fetch = inspection_fetch();
        let lock = self.lock_for(&location.common_directory);
        let Some(_repository) = unless_cancelled(stop, lock.lock()).await else {
            return stopped();
        };
        let _slot = if fetch == Fetch::Allowed {
            match unless_cancelled(stop, self.0.slots.clone().acquire_owned()).await {
                None => return stopped(),
                Some(permit) => permit.ok(),
            }
        } else {
            None
        };

        match inspect_checkout(&location, fetch, stop).await {
            Ok(inspection) => InspectionResult::Inspected { inspection },
            Err(error) => failed(error.message),
        }
    }
}
