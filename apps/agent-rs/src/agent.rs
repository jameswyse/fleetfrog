//! Staying connected to the hub: one session per connection, following the hub's commands, with
//! reconnection and backoff between sessions.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::actions::archive::Folders;
use crate::actions::runner::ActionRunner;
use crate::config::{
    AgentConfig, ConfigUnavailable, load_agent_config, load_policy, policy_path,
    record_policy_defaults,
};
use crate::folders::create_project_folder;
use crate::hub::rpc::{HubClient, RpcError, StreamItem};
use crate::log;
use crate::machine::{read_machine_info, read_system_usage};
use crate::protocol::{
    ACTION_KINDS, ActionUpdate, AgentCapabilities, Configuration, GithubCli, HubCommand, Tier,
    failed,
};
use crate::scanner::Scanner;
use crate::store::default_trash_directory;
use crate::update;

/// Sent every `heartbeatSeconds`. The hub ends a connection that goes quiet.
const HEARTBEAT: Duration = Duration::from_secs(15);
const FIRST_RETRY_DELAY: Duration = Duration::from_secs(1);
const MAXIMUM_RETRY_DELAY: Duration = Duration::from_secs(60);
/// Disk space and load change slowly, and a minute keeps the dashboard current enough.
const USAGE_INTERVAL: Duration = Duration::from_secs(60);
/// How long an ending session waits for an inspection to finish once its fetch has stopped.
const INSPECTION_STOP: Duration = Duration::from_secs(5);
/// A connection that lasted this long was healthy, so the next retry starts from the shortest delay.
const HEALTHY_CONNECTION: Duration = Duration::from_secs(60);

pub enum AgentStopped {
    NotPaired,
    /// The hub no longer accepts this machine's token, usually because it was removed.
    MachineRemoved,
    ConfigUnavailable(ConfigUnavailable),
    /// The owner stopped the agent, such as with Ctrl-C or the service manager.
    Stopped,
    /// The hub had the agent update itself, and the new binary is at `executable`.
    Updated {
        executable: PathBuf,
    },
}

/// Every action this agent knows, with the tiers its policy allows. A damaged policy allows none.
fn read_capabilities() -> AgentCapabilities {
    match load_policy() {
        Ok(policy) => AgentCapabilities {
            actions: ACTION_KINDS.to_vec(),
            allowed_tiers: policy.allowed_tiers,
            policy_readable: true,
            creates_folders: true,
            updates_itself: update::UPDATES_ITSELF,
        },
        Err(_) => AgentCapabilities {
            actions: ACTION_KINDS.to_vec(),
            allowed_tiers: Vec::new(),
            policy_readable: false,
            creates_folders: true,
            updates_itself: update::UPDATES_ITSELF,
        },
    }
}

/// Says once, rather than every heartbeat, that the policy can't be read.
fn warn_if_unreadable(capabilities: &AgentCapabilities) {
    if !capabilities.policy_readable {
        log::warning_only(&format!(
            "The policy at {} can't be read, so no actions are allowed",
            policy_path()
        ));
    }
}

enum SessionEnd {
    Closed,
    Disconnected(String),
    MachineRemoved,
    /// An update was installed, so the agent restarts on it.
    Updated(PathBuf),
}

/// A command from a newer hub that this agent can't read.
#[derive(Debug, PartialEq, Eq)]
struct Unreadable {
    tag: String,
    /// The run the hub is waiting on, when the command carries one.
    run_id: Option<String>,
}

/// Reads a command from the hub. A newer hub may send one this agent can't read, which is skipped
/// instead of ending the connection.
fn read_command(received: Value) -> Result<HubCommand, Unreadable> {
    let unreadable = |received: &Value| Unreadable {
        tag: received
            .get("_tag")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        run_id: received
            .get("runId")
            .and_then(Value::as_str)
            .map(String::from),
    };

    match serde_json::from_value::<HubCommand>(received.clone()) {
        Ok(HubCommand::RunAction { request, .. }) if !request.is_valid() => {
            Err(unreadable(&received))
        }
        Ok(command) => Ok(command),
        Err(_) => Err(unreadable(&received)),
    }
}

/// The session's timers, which restart whenever the configuration changes.
struct Schedule {
    configuration: Option<Configuration>,
    last_discovery: Option<Instant>,
    last_status: Option<Instant>,
    timers: Option<JoinHandle<()>>,
}

struct Session {
    client: Arc<HubClient>,
    scanner: Arc<Scanner>,
    runner: ActionRunner,
    folders: Arc<Mutex<Folders>>,
    home: String,
    schedule: Arc<Mutex<Schedule>>,
    /// Scans, which run in the session rather than under a timer, so restarting the timers never
    /// cuts one short.
    tasks: Mutex<Vec<tokio::task::AbortHandle>>,
    /// Inspections, which the runner stops when the session ends, so any fetch stops cleanly.
    inspections: Mutex<Vec<JoinHandle<()>>>,
    /// Where an update the hub asked for was installed, once it has been. The session then ends.
    installed: watch::Sender<Option<PathBuf>>,
}

impl Session {
    /// Keeps a task the session started, so ending the session stops it.
    fn track(&self, task: JoinHandle<()>) -> JoinHandle<()> {
        let mut tasks = self.tasks.lock().unwrap();

        tasks.retain(|task| !task.is_finished());
        tasks.push(task.abort_handle());
        task
    }

    /// Restarts both timers, keeping each on its cadence from its last completed pass.
    fn reschedule(self: &Arc<Self>, discover_now: bool) {
        let mut schedule = self.schedule.lock().unwrap();
        let Some(current) = schedule.configuration.clone() else {
            return;
        };
        let now = Instant::now();
        let remaining = |seconds: u64, since: Option<Instant>| match since {
            None => Duration::ZERO,
            Some(since) => Duration::from_secs(seconds).saturating_sub(now - since),
        };
        let until_discovery = if discover_now {
            Duration::ZERO
        } else {
            remaining(current.schedule.discovery_seconds, schedule.last_discovery)
        };
        let until_status = match schedule.last_status {
            None => Duration::from_secs(current.schedule.status_seconds),
            since => remaining(current.schedule.status_seconds, since),
        };

        if let Some(timers) = schedule.timers.take() {
            timers.abort();
        }

        let session = self.clone();

        schedule.timers = Some(tokio::spawn(async move {
            let discovery = {
                let session = session.clone();
                let current = current.clone();

                async move {
                    tokio::time::sleep(until_discovery).await;

                    loop {
                        let pass = session.clone();
                        let configuration = current.clone();
                        let _ = session
                            .track(tokio::spawn(
                                async move { pass.discover(&configuration).await },
                            ))
                            .await;

                        tokio::time::sleep(Duration::from_secs(current.schedule.discovery_seconds))
                            .await;
                    }
                }
            };
            let status = async move {
                tokio::time::sleep(until_status).await;

                loop {
                    let pass = session.clone();
                    let configuration = current.clone();
                    let _ = session
                        .track(tokio::spawn(
                            async move { pass.status(&configuration).await },
                        ))
                        .await;

                    tokio::time::sleep(Duration::from_secs(current.schedule.status_seconds)).await;
                }
            };

            tokio::join!(discovery, status);
        }));
    }

    async fn discover(&self, current: &Configuration) {
        let result = self
            .scanner
            .discover(
                &current.discovery_roots,
                current.archive_folder.as_deref(),
                Duration::from_secs(current.schedule.github_seconds),
                current.t3_code,
            )
            .await;

        match result {
            Ok(()) => {
                let mut schedule = self.schedule.lock().unwrap();
                let now = Instant::now();

                schedule.last_discovery = Some(now);
                schedule.last_status = Some(now);
            }
            Err(error) => log::warning("Discovery failed", error),
        }
    }

    async fn status(&self, current: &Configuration) {
        match self
            .scanner
            .status(
                Duration::from_secs(current.schedule.github_seconds),
                current.t3_code,
            )
            .await
        {
            Ok(()) => self.schedule.lock().unwrap().last_status = Some(Instant::now()),
            Err(error) => log::warning("Status scan failed", error),
        }
    }

    /// Follows one command from the hub.
    async fn handle(self: &Arc<Self>, received: Value) {
        let command = match read_command(received) {
            Ok(command) => command,
            Err(unreadable) => {
                log::warning_only(&format!(
                    "Skipped a command this agent can't read: {}",
                    unreadable.tag
                ));

                // A run the hub is waiting on ends as failed, rather than staying queued forever.
                if let Some(run_id) = unreadable.run_id {
                    let update = ActionUpdate::Finished {
                        outcome: failed(
                            "This machine's agent can't read the request. Update the agent.",
                        ),
                        output: Vec::new(),
                    };
                    let reported = self
                        .client
                        .call(
                            "ReportAction",
                            Some(json!({ "runId": run_id, "update": update })),
                        )
                        .await;

                    if let Err(error) = reported {
                        log::warning("Could not report a skipped run", error);
                    }
                }

                return;
            }
        };

        match command {
            HubCommand::Configure(next) => {
                // Each of these changes where checkouts are found or what's reported about them, so
                // discovery runs again at once.
                let discovery_changed = {
                    let mut schedule = self.schedule.lock().unwrap();
                    let changed = schedule.configuration.as_ref().is_none_or(|current| {
                        current.discovery_roots != next.discovery_roots
                            || current.archive_folder != next.archive_folder
                            || current.t3_code != next.t3_code
                    });

                    *self.folders.lock().unwrap() = Folders {
                        roots: next.discovery_roots.clone(),
                        archive_folder: next.archive_folder.clone(),
                    };
                    schedule.configuration = Some(next);
                    changed
                };

                self.reschedule(discovery_changed);
            }
            HubCommand::Refresh {} => self.reschedule(true),
            HubCommand::RunAction { run_id, request } => self.runner.run(run_id, request),
            HubCommand::CancelAction { run_id } => self.runner.cancel(&run_id),
            HubCommand::CreateFolder { request_id, path } => {
                let folders = self.folders.lock().unwrap().clone();
                let outcome = create_project_folder(
                    &path,
                    &folders.roots,
                    folders.archive_folder.as_deref(),
                    &self.home,
                );
                let answered = self
                    .client
                    .call(
                        "ReportFolder",
                        Some(json!({ "requestId": request_id, "outcome": outcome })),
                    )
                    .await;

                match answered {
                    Err(error) => log::warning("Could not answer a folder request", error),
                    // Rediscovers so the hub sees the folder, including one that was there all along.
                    Ok(_) if !matches!(outcome, crate::protocol::FolderOutcome::Failed { .. }) => {
                        self.reschedule(true)
                    }
                    Ok(_) => {}
                }
            }
            // An inspection fetches and measures, so it runs beside the commands that follow it.
            HubCommand::Inspect {
                request_id,
                path,
                worktree,
            } => {
                let session = self.clone();

                let mut inspections = self.inspections.lock().unwrap();

                inspections.retain(|inspection| !inspection.is_finished());
                inspections.push(tokio::spawn(async move {
                    let result = session.runner.inspect(&path, worktree.as_deref()).await;

                    if let Err(error) = session
                        .client
                        .call(
                            "ReportInspection",
                            Some(json!({ "requestId": request_id, "result": result })),
                        )
                        .await
                    {
                        log::warning("Could not answer an inspection", error);
                    }
                }));
            }
            HubCommand::Update { version } => self.update(version),
        }
    }

    /// Installs the hub's version beside the running session. An update the session ends before is
    /// abandoned, and a failed one is reported so the hub stops waiting for the agent to restart.
    fn update(self: &Arc<Self>, version: String) {
        let session = self.clone();

        log::info(&format!("Updating the agent to {version}"));
        self.track(tokio::spawn(async move {
            let installed = if load_policy().is_ok_and(|policy| policy.allows(Tier::Update)) {
                update::install(&version).await
            } else {
                Err(
                    "This machine's owner hasn't allowed updates from the hub. Run fleetfrog allow update on it, or fleetfrog update there."
                        .to_string(),
                )
            };

            match installed {
                Ok(executable) => {
                    log::info(&format!("Installed the agent {version}"));
                    session.installed.send_replace(Some(executable));
                }
                Err(message) => {
                    log::warning(
                        &format!("Could not update the agent to {version}"),
                        &message,
                    );

                    if let Err(error) = session
                        .client
                        .call(
                            "ReportUpdateFailure",
                            Some(json!({ "version": version, "message": message })),
                        )
                        .await
                    {
                        log::warning("Could not report the failed update", error);
                    }
                }
            }
        }));
    }

    async fn shut_down(&self) {
        if let Some(timers) = self.schedule.lock().unwrap().timers.take() {
            timers.abort();
        }

        // Scans only read, so they stop at once.
        for task in std::mem::take(&mut *self.tasks.lock().unwrap()) {
            task.abort();
        }

        // Stopping the runner stops the actions that can stop, and any fetch an inspection is
        // running, then waits for the rest.
        self.runner.shut_down().await;

        let inspections = std::mem::take(&mut *self.inspections.lock().unwrap());

        for inspection in inspections {
            let stopping = inspection.abort_handle();

            if tokio::time::timeout(INSPECTION_STOP, inspection)
                .await
                .is_err()
            {
                stopping.abort();
            }
        }

        self.client.close().await;
    }
}

/// Waits for `future` unless the owner stops the agent first.
async fn unless_stopped<T>(
    stopping: &crate::process::Cancel,
    future: impl Future<Output = T>,
) -> Option<T> {
    tokio::select! {
        biased;
        () = stopping.cancelled() => None,
        value = future => Some(value),
    }
}

/// One connection to the hub: follows its commands until the connection ends.
async fn run_session(config: &AgentConfig, stopping: &crate::process::Cancel) -> SessionEnd {
    let client = match unless_stopped(stopping, HubClient::connect(config)).await {
        None => return SessionEnd::Closed,
        Some(Ok(client)) => Arc::new(client),
        Some(Err(error)) => return SessionEnd::Disconnected(error),
    };

    log::info("Connected to hub");

    let Some(info) = unless_stopped(stopping, read_machine_info()).await else {
        client.close().await;
        return SessionEnd::Closed;
    };
    let folders = Arc::new(Mutex::new(Folders::default()));
    let login = match &info.github_cli {
        GithubCli::Available { login } => Some(login.clone()),
        GithubCli::Unavailable { .. } => None,
    };
    let scanner = Arc::new(Scanner::new(
        client.clone(),
        login,
        default_trash_directory(),
        folders.clone(),
    ));
    let runner = ActionRunner::new(
        scanner.clone(),
        client.clone(),
        folders.clone(),
        default_trash_directory(),
    );
    let session = Arc::new(Session {
        client: client.clone(),
        scanner,
        runner,
        folders,
        home: info.home_directory.clone(),
        schedule: Arc::new(Mutex::new(Schedule {
            configuration: None,
            last_discovery: None,
            last_status: None,
            timers: None,
        })),
        tasks: Mutex::new(Vec::new()),
        inspections: Mutex::new(Vec::new()),
        installed: watch::channel(None).0,
    });
    let mut installed = session.installed.subscribe();
    let capabilities = read_capabilities();

    warn_if_unreadable(&capabilities);

    let usage = {
        let client = client.clone();

        tokio::spawn(async move {
            loop {
                if let Err(error) = client
                    .call(
                        "ReportUsage",
                        Some(json!({ "usage": read_system_usage().await })),
                    )
                    .await
                {
                    log::warning("Could not report system usage", error);
                }

                tokio::time::sleep(USAGE_INTERVAL).await;
            }
        })
    };
    // The owner may change the policy at any time, so each heartbeat checks it.
    let heartbeat = {
        let client = client.clone();
        let mut advertised = capabilities.clone();

        tokio::spawn(async move {
            loop {
                if let Err(error) = client.call("Heartbeat", None).await {
                    log::warning("Could not send a heartbeat", error);
                }

                let current = read_capabilities();

                if current.policy_readable != advertised.policy_readable
                    || current.allowed_tiers != advertised.allowed_tiers
                {
                    warn_if_unreadable(&current);

                    if let Err(error) = client
                        .call("Advertise", Some(json!({ "capabilities": current })))
                        .await
                    {
                        log::warning("Could not advertise the policy", error);
                    }

                    advertised = current;
                }

                tokio::time::sleep(HEARTBEAT).await;
            }
        })
    };
    let end = match client.stream(
        "Connect",
        json!({ "info": info, "capabilities": capabilities }),
    ) {
        Err(error) => SessionEnd::Disconnected(error.to_string()),
        Ok(mut commands) => loop {
            let item = tokio::select! {
                item = commands.recv() => item,
                _ = client.dropped.cancelled() => break SessionEnd::Disconnected("The connection to the hub closed".into()),
                _ = stopping.cancelled() => break SessionEnd::Closed,
                // Ends as updated below, once running actions have finished.
                _ = installed.wait_for(Option::is_some) => break SessionEnd::Closed,
            };

            match item {
                Some(StreamItem::Value(command)) => session.handle(command).await,
                Some(StreamItem::End(Ok(()))) => break SessionEnd::Closed,
                Some(StreamItem::End(Err(error))) if error.is_tagged("Unauthorised") => {
                    break SessionEnd::MachineRemoved;
                }
                Some(StreamItem::End(Err(RpcError::Disconnected))) | None => {
                    break SessionEnd::Disconnected("The connection to the hub closed".into());
                }
                Some(StreamItem::End(Err(error))) => {
                    break SessionEnd::Disconnected(error.to_string());
                }
            }
        },
    };

    usage.abort();
    heartbeat.abort();
    session.shut_down().await;

    // An update installed before the session ended for any other reason still needs a restart.
    match session.installed.borrow().clone() {
        Some(executable) => SessionEnd::Updated(executable),
        None => end,
    }
}

/// Stays connected to the hub, reconnecting with backoff, until the machine is removed, the owner
/// stops the agent, or it updates itself.
pub async fn run_agent(stopping: crate::process::Cancel) -> AgentStopped {
    let config = match load_agent_config() {
        Err(error) => return AgentStopped::ConfigUnavailable(error),
        Ok(None) => return AgentStopped::NotPaired,
        Ok(Some(config)) => config,
    };

    // An update may have added tiers this machine's owner hasn't decided yet.
    match record_policy_defaults() {
        Ok(defaulted) if !defaulted.is_empty() => {
            let names: Vec<&str> = defaulted.iter().map(|tier| tier.as_str()).collect();

            log::info(&format!(
                "Recorded the default for {} in {}",
                names.join(", "),
                policy_path()
            ));
        }
        Ok(_) => {}
        Err(error) => log::warning("Could not record the policy's defaults", error.message),
    }

    let mut delay = FIRST_RETRY_DELAY;

    loop {
        let started = Instant::now();

        match run_session(&config, &stopping).await {
            SessionEnd::MachineRemoved => return AgentStopped::MachineRemoved,
            _ if stopping.is_cancelled() => return AgentStopped::Stopped,
            SessionEnd::Updated(executable) => return AgentStopped::Updated { executable },
            SessionEnd::Closed => log::info("The hub closed the connection"),
            SessionEnd::Disconnected(reason) => log::warning("Disconnected from hub", reason),
        }

        if started.elapsed() > HEALTHY_CONNECTION {
            delay = FIRST_RETRY_DELAY;
        }

        tokio::select! {
            _ = tokio::time::sleep(delay) => {}
            _ = stopping.cancelled() => return AgentStopped::Stopped,
        }

        delay = (delay * 2).min(MAXIMUM_RETRY_DELAY);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_commands_it_cannot_read() {
        let newer_action = json!({"_tag": "RunAction", "runId": "r1", "request": {"_tag": "Teleport", "path": "/p"}});
        let newer_command = json!({"_tag": "Defragment"});
        let empty_branches = json!({"_tag": "RunAction", "runId": "r2", "request": {"_tag": "DeleteBranches", "path": "/p", "branches": []}});

        assert_eq!(
            read_command(newer_action).unwrap_err(),
            Unreadable {
                tag: "RunAction".into(),
                run_id: Some("r1".into())
            }
        );
        assert_eq!(
            read_command(newer_command).unwrap_err(),
            Unreadable {
                tag: "Defragment".into(),
                run_id: None
            }
        );
        assert_eq!(
            read_command(empty_branches).unwrap_err().run_id.as_deref(),
            Some("r2")
        );
        assert!(matches!(
            read_command(json!({"_tag": "CancelAction", "runId": "r3"})),
            Ok(HubCommand::CancelAction { .. })
        ));
    }
}
