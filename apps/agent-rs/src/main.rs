//! The FleetFrog agent as a native binary: reports a development machine's repositories to a
//! FleetFrog hub and runs the actions its owner allows. It reads and writes the same files as the
//! TypeScript agent in `apps/agent-ts`, so either can run on a machine.

mod actions;
mod agent;
mod audit;
mod config;
mod discovery;
mod folders;
mod git;
mod github;
mod http;
mod hub;
mod inspect;
mod instance;
mod log;
mod machine;
mod output;
mod pairing;
mod paths;
mod process;
mod protocol;
mod scanner;
mod service;
mod store;
mod t3code;
mod time;
mod update;

use std::io::{IsTerminal, Write};
use std::path::Path;
use std::process::ExitCode;

use protocol::Tier;

const USAGE: &str = "Report this machine's repositories to a FleetFrog hub

Usage: fleetfrog <command>

Commands:
  pair <pairing-string>   Pair this machine with a FleetFrog hub
      --insecure          Allow an unencrypted connection to a hub on another machine
      --allow <tier>      Allow a tier of actions from the start, as `fleetfrog allow` does. Repeatable.
  run                     Connect to the hub and report this machine's repositories
  status                  Show how this agent is paired
  service install         Run the agent in the background whenever you are logged in
  service uninstall       Stop the background agent and remove its service
  allow <tier>            Let the hub run a tier of actions here
  deny <tier>             Stop the hub from running a tier of actions here
  update                  Update this agent to the version its hub runs
      -y, --yes           Update without asking first

Environment:
  FLEETFROG_INSTANCE  Run a second agent beside the default one, such as dev, with its own pairing,
                      policy, action log and service. Use lowercase letters, digits and hyphens.

Tiers:
  git      Git actions: fetch, pull (fast-forward only), clone into a project folder, switch branches and stash changes
  cleanup  Cleanup actions: delete branches, archive checkouts, move them to the trash or delete them, and restore or empty the trash

Options:
  -h, --help     Show this help
  -v, --version  Show the agent's version";

/// Explains an expected failure on standard error and marks the process as failed.
fn report_failure(message: &str) -> ExitCode {
    eprintln!("{message}");
    ExitCode::FAILURE
}

fn usage_error(message: &str) -> ExitCode {
    eprintln!("{message}\n\n{USAGE}");
    ExitCode::FAILURE
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("the async runtime starts")
}

fn parse_tier(value: Option<&String>) -> Result<Tier, ExitCode> {
    match value {
        None => Err(usage_error("Missing the tier: git or cleanup.")),
        Some(value) => Tier::parse(value).ok_or_else(|| {
            usage_error(&format!(
                "Unknown tier \"{value}\". Expected git or cleanup."
            ))
        }),
    }
}

fn pair(arguments: &[String]) -> ExitCode {
    let mut pairing_string = None;
    let mut insecure = false;
    let mut allow = Vec::new();
    let mut rest = arguments.iter();

    while let Some(argument) = rest.next() {
        match argument.as_str() {
            "--insecure" => insecure = true,
            "--allow" => match parse_tier(rest.next()) {
                Ok(tier) => allow.push(tier),
                Err(code) => return code,
            },
            flag if flag.starts_with("--allow=") => {
                match parse_tier(Some(&flag["--allow=".len()..].to_string())) {
                    Ok(tier) => allow.push(tier),
                    Err(code) => return code,
                }
            }
            flag if flag.starts_with('-') => {
                return usage_error(&format!("Unknown option {flag}."));
            }
            value if pairing_string.is_none() => pairing_string = Some(value.to_string()),
            value => return usage_error(&format!("Unexpected argument {value}.")),
        }
    }

    let Some(pairing_string) = pairing_string else {
        return usage_error(
            "Missing the pairing string shown when pairing a machine in the dashboard.",
        );
    };

    match runtime().block_on(pairing::pair_with_hub(&pairing_string, insecure)) {
        Ok(machine_id) => {
            if let Err(error) = config::change_policy(&allow, &[]) {
                return report_failure(&format!(
                    "Could not update the policy at {}: {}",
                    error.path, error.message
                ));
            }

            println!(
                "Paired as machine {machine_id}. Credentials saved to {}.\nRun `fleetfrog service install` to keep the agent running, or `fleetfrog run` to try it in this terminal.",
                config::config_path()
            );
            ExitCode::SUCCESS
        }
        Err(pairing::PairError::Refused(message)) => report_failure(&message),
        Err(pairing::PairError::InvalidPairingCode) => report_failure(
            "The hub rejected the pairing code. Codes work once and expire after 10 minutes.",
        ),
        Err(pairing::PairError::CertificateMismatch) => report_failure(
            "The hub's certificate does not match the pairing string. Nothing was sent. Check that you are pairing with the right hub.",
        ),
        Err(pairing::PairError::ConfigUnavailable(error)) => report_failure(&format!(
            "Could not save the pairing to {}: {}",
            error.path, error.message
        )),
        Err(pairing::PairError::HubUnreachable(message)) => {
            report_failure(&format!("Could not reach the hub: {message}"))
        }
    }
}

/// Being unpaired or removed are finished states rather than crashes, so `run` stops with a zero
/// exit code and the installed service does not restart it every few seconds. Stopping by signal
/// exits with 130 once running actions have finished, as the TypeScript agent does.
fn run() -> ExitCode {
    let runtime = runtime();
    let stopped = runtime.block_on(async {
        let stopping = process::Cancel::new();
        let signals = {
            let stopping = stopping.clone();

            tokio::spawn(async move {
                use tokio::signal::unix::{SignalKind, signal};

                let (Ok(mut terminate), Ok(mut interrupt)) = (
                    signal(SignalKind::terminate()),
                    signal(SignalKind::interrupt()),
                ) else {
                    return;
                };

                tokio::select! {
                    _ = terminate.recv() => {}
                    _ = interrupt.recv() => {}
                }

                stopping.cancel();
            })
        };
        let stopped = agent::run_agent(stopping).await;

        signals.abort();
        stopped
    });

    match stopped {
        agent::AgentStopped::NotPaired => {
            eprintln!(
                "This machine is not paired yet. Run `fleetfrog pair <pairing-string>` first."
            );
            ExitCode::SUCCESS
        }
        agent::AgentStopped::MachineRemoved => {
            eprintln!(
                "The hub no longer recognises this machine. Pair it again from the dashboard."
            );
            ExitCode::SUCCESS
        }
        agent::AgentStopped::ConfigUnavailable(error) => report_failure(&format!(
            "Could not read the pairing from {}: {}",
            error.path, error.message
        )),
        agent::AgentStopped::Stopped => ExitCode::from(130),
        agent::AgentStopped::Updated { executable } => {
            runtime.shutdown_background();
            restart(&executable)
        }
    }
}

/// Becomes the updated agent at `executable`, keeping this process's id and environment, so the
/// service manager sees its service carry on and a named instance stays that instance. When that
/// fails, exiting with failure has the service manager start the new binary instead.
fn restart(executable: &Path) -> ExitCode {
    use std::os::unix::process::CommandExt;

    log::info("Restarting on the updated agent");

    let error = std::process::Command::new(executable).arg("run").exec();

    log::error("Could not restart on the updated agent", error);
    ExitCode::FAILURE
}

fn status() -> ExitCode {
    let (config, policy) = match (config::load_agent_config(), config::load_policy()) {
        (Err(error), _) | (_, Err(error)) => {
            return report_failure(&format!("Could not read {}: {}", error.path, error.message));
        }
        (Ok(config), Ok(policy)) => (config, policy),
    };

    match config {
        None => println!(
            "FleetFrog agent {} (Rust)\nNot paired. Run `fleetfrog pair <pairing-string>`.",
            machine::AGENT_VERSION
        ),
        Some(config) => {
            let tiers: Vec<&str> = policy
                .allowed_tiers
                .iter()
                .map(|tier| tier.as_str())
                .collect();

            println!(
                "FleetFrog agent {} (Rust)\nHub: {}\nMachine: {}\nHub certificate: {}\nCredentials: {}\nAllowed actions: {} ({})\nAudit log: {}",
                machine::AGENT_VERSION,
                config.agent_url,
                config.machine_id,
                if config.certificate_pem.is_none() {
                    "publicly trusted"
                } else {
                    "pinned at pairing"
                },
                config::config_path(),
                if tiers.is_empty() {
                    "none".to_string()
                } else {
                    tiers.join(", ")
                },
                config::policy_path(),
                audit::audit_log_path()
            );
        }
    }

    ExitCode::SUCCESS
}

fn service_command(arguments: &[String]) -> ExitCode {
    let runtime = runtime();

    match arguments.first().map(String::as_str) {
        Some("install") => match runtime.block_on(service::install()) {
            Ok(definition) if cfg!(target_os = "linux") => {
                println!(
                    "Installed and started {definition}.\nTo keep it running while you are logged out, run `loginctl enable-linger`."
                );
                ExitCode::SUCCESS
            }
            Ok(definition) => {
                println!("Installed and started {definition}.");
                ExitCode::SUCCESS
            }
            Err(service::ServiceError::CommandFailed(message)) => {
                report_failure(&format!("Could not start the service: {message}"))
            }
            Err(service::ServiceError::FileFailed { path, message }) => {
                report_failure(&format!("Could not write {path}: {message}"))
            }
        },
        Some("uninstall") => match runtime.block_on(service::uninstall()) {
            Ok(definition) => {
                println!("Stopped the agent and removed {definition}.");
                ExitCode::SUCCESS
            }
            Err(service::ServiceError::CommandFailed(message)) => {
                report_failure(&format!("Could not remove the service: {message}"))
            }
            Err(service::ServiceError::FileFailed { path, message }) => {
                report_failure(&format!("Could not remove {path}: {message}"))
            }
        },
        _ => usage_error("Expected `service install` or `service uninstall`."),
    }
}

/// Allows or denies one tier. A running agent picks the change up at its next heartbeat.
fn set_tier(arguments: &[String], allow: bool) -> ExitCode {
    let tier = match parse_tier(arguments.first()) {
        Ok(tier) => tier,
        Err(code) => return code,
    };
    let (allowed, denied, verb) = if allow {
        (vec![tier], vec![], "allowed")
    } else {
        (vec![], vec![tier], "denied")
    };

    match config::change_policy(&allowed, &denied) {
        Err(error) => report_failure(&format!(
            "Could not update the policy at {}: {}",
            error.path, error.message
        )),
        Ok(change) => {
            if change.replaced_damaged {
                println!(
                    "The saved policy at {} couldn't be read, so it was replaced.",
                    config::policy_path()
                );
            }

            if change.changed {
                println!(
                    "{} actions are now {verb} on this machine. The hub sees the change within 15 seconds.",
                    tier.as_str()
                );
            } else {
                println!(
                    "{} actions were already {verb} on this machine.",
                    tier.as_str()
                );
            }

            ExitCode::SUCCESS
        }
    }
}

/// Asks before updating. Without a terminal to ask on, `--yes` has to say so up front.
fn confirm(version: &str) -> Result<bool, ExitCode> {
    if !std::io::stdin().is_terminal() {
        return Err(report_failure(
            "Standard input isn't a terminal, so the update can't be confirmed. Pass --yes to update without asking.",
        ));
    }

    print!("Update the agent to {version}? [y/N] ");
    let _ = std::io::stdout().flush();

    let mut answer = String::new();

    if std::io::stdin().read_line(&mut answer).is_err() {
        return Ok(false);
    }

    Ok(matches!(
        answer.trim().to_ascii_lowercase().as_str(),
        "y" | "yes"
    ))
}

/// Prints what changed in the agent after `installed`, up to `target`.
fn print_changes(runtime: &tokio::runtime::Runtime, installed: &str, target: &str) {
    let page = update::changelog::page_url(target);

    match runtime.block_on(update::changelog::fetch(target)) {
        Err(error) => println!("Could not fetch the changelog: {error}."),
        Ok(markdown) => {
            let releases =
                update::changelog::between(update::changelog::parse(&markdown), installed, target);
            let (lines, omitted) =
                update::changelog::summarise(&releases, update::changelog::ENTRY_LIMIT);

            if lines.is_empty() {
                println!("The agent has no changes of its own between {installed} and {target}.");
            } else {
                println!(
                    "Changes to the agent since {installed}:\n\n{}\n",
                    lines.join("\n")
                );
            }

            if omitted > 0 {
                println!(
                    "Plus {omitted} more {}.",
                    if omitted == 1 { "change" } else { "changes" }
                );
            }
        }
    }

    println!("Full changelog: {page}\n");
}

/// Updates the agent to the version its hub runs, after showing what changed and asking. A
/// service moves to the new binary and restarts on it, as the install script does.
fn update_command(arguments: &[String]) -> ExitCode {
    let mut yes = false;

    for argument in arguments {
        match argument.as_str() {
            "-y" | "--yes" => yes = true,
            flag if flag.starts_with('-') => {
                return usage_error(&format!("Unknown option {flag}."));
            }
            value => return usage_error(&format!("Unexpected argument {value}.")),
        }
    }

    if !update::UPDATES_ITSELF {
        return report_failure(update::BUILT_FROM_SOURCE);
    }

    let config = match config::load_agent_config() {
        Err(error) => {
            return report_failure(&format!(
                "Could not read the pairing from {}: {}",
                error.path, error.message
            ));
        }
        Ok(None) => {
            return report_failure(
                "This machine is not paired yet, so there's no hub to take a version from. Run `fleetfrog pair <pairing-string>` first.",
            );
        }
        Ok(Some(config)) => config,
    };
    let runtime = runtime();
    let current = machine::AGENT_VERSION;
    let target = match runtime.block_on(update::target_version(&config)) {
        Ok(version) => version,
        Err(update::TargetError::Unreachable(message)) => {
            return report_failure(&format!("Could not reach the hub: {message}"));
        }
        Err(update::TargetError::HubTooOld) => {
            return report_failure(
                "The hub is too old to say which version its agents should run. Update the hub first.",
            );
        }
        Err(update::TargetError::MachineRemoved) => {
            return report_failure(
                "The hub no longer recognises this machine. Pair it again from the dashboard.",
            );
        }
        Err(update::TargetError::Failed(message)) => {
            return report_failure(&format!(
                "The hub couldn't say which version to run: {message}"
            ));
        }
    };

    match update::compare_versions(current, &target) {
        std::cmp::Ordering::Equal => {
            println!("The agent is up to date with the hub on {current}.");
            return ExitCode::SUCCESS;
        }
        std::cmp::Ordering::Greater => {
            println!(
                "The agent runs {current}, which is newer than the hub's {target}. Update the hub to match."
            );
            return ExitCode::SUCCESS;
        }
        std::cmp::Ordering::Less => {}
    }

    println!("The hub runs {target}, and this agent runs {current}.\n");
    print_changes(&runtime, current, &target);

    if !yes {
        match confirm(&target) {
            Err(code) => return code,
            Ok(false) => {
                println!("The agent wasn't updated.");
                return ExitCode::SUCCESS;
            }
            Ok(true) => {}
        }
    }

    let executable = match runtime.block_on(update::install(&target)) {
        Ok(executable) => executable,
        Err(message) => return report_failure(&message),
    };

    println!("Updated the agent to {target} at {}.", executable.display());

    if !service::is_installed() {
        println!("Restart any agent started with `fleetfrog run` to use the new version.");
        return ExitCode::SUCCESS;
    }

    // Installing the service from the new binary moves it here and restarts it on the new version.
    match std::process::Command::new(&executable)
        .args(["service", "install"])
        .status()
    {
        Ok(status) if status.success() => ExitCode::SUCCESS,
        Ok(_) => report_failure(
            "The agent's service didn't restart. Run `fleetfrog service install` to try again.",
        ),
        Err(error) => report_failure(&format!(
            "The agent's service didn't restart: {error}. Run `fleetfrog service install` to try again."
        )),
    }
}

/// Prints what a discovery walk of `roots` finds, as the hub would receive it. Used to compare
/// this agent's readings with the TypeScript agent's.
fn scan(arguments: &[String]) -> ExitCode {
    runtime().block_on(async {
        let locations = discovery::discover_checkouts(arguments, None, &[]).await;
        let mut checkouts = Vec::new();

        for location in locations {
            let status = match git::read_git_status(&location).await {
                Ok(status) => serde_json::to_value(protocol::CheckoutStatus::Read {
                    git: Box::new(status),
                }),
                Err(error) => serde_json::to_value(protocol::CheckoutStatus::Failed {
                    message: error.message,
                }),
            };

            checkouts.push(serde_json::json!({
                "path": location.path,
                "identity": location.identity,
                "originUrl": location.origin_url,
                "directoryName": location.directory_name,
                "worktree": location.worktree,
                "placement": location.placement,
                "status": status.unwrap_or_default(),
            }));
        }

        println!("{}", serde_json::Value::Array(checkouts));
        ExitCode::SUCCESS
    })
}

/// Prints an inspection of the checkout at the first path, or of its linked worktree at the second,
/// without fetching. Used to compare this agent's fingerprints with the TypeScript agent's.
fn inspect(arguments: &[String]) -> ExitCode {
    runtime().block_on(async {
        let Some(location) =
            git::locate_checkout(arguments.first().map(String::as_str).unwrap_or("")).await
        else {
            println!("null");
            return ExitCode::SUCCESS;
        };
        let result = match arguments.get(1) {
            None => match inspect::inspect_checkout(
                &location,
                inspect::Fetch::NotAllowed,
                &process::Cancel::new(),
            )
            .await
            {
                Ok(inspection) => protocol::InspectionResult::Inspected { inspection },
                Err(error) => protocol::InspectionResult::Failed {
                    message: error.message,
                },
            },
            Some(worktree) => match inspect::inspect_worktree(
                &location.path,
                &location.common_directory,
                worktree,
                &process::Cancel::new(),
            )
            .await
            {
                Ok(Some(inspection)) => {
                    protocol::InspectionResult::WorktreeInspected { inspection }
                }
                _ => protocol::InspectionResult::Failed {
                    message: "No such worktree".into(),
                },
            },
        };

        println!("{}", serde_json::to_string(&result).unwrap_or_default());
        ExitCode::SUCCESS
    })
}

/// Prints what the agent reads from the T3 Code database at the first path, with project icons.
/// Used to compare this agent's reading with the TypeScript agent's.
fn t3code(arguments: &[String]) -> ExitCode {
    runtime().block_on(async {
        let database = arguments.first().map(String::as_str).unwrap_or("");
        let read = t3code::read_t3code(database, true, &mut t3code::Favicons::new()).await;

        println!(
            "{}",
            serde_json::json!({ "status": read.status, "icons": read.icons })
        );
        ExitCode::SUCCESS
    })
}

/// Prints what the agent reads from GitHub, as the user with the first login, about the checkout at
/// the second path. Used to compare this agent's reading with the TypeScript agent's.
fn github(arguments: &[String]) -> ExitCode {
    runtime().block_on(async {
        let (Some(login), Some(path)) = (arguments.first(), arguments.get(1)) else {
            return usage_error("Expected a GitHub login and a checkout.");
        };
        let state = match git::locate_checkout(path).await {
            None => None,
            Some(location) => {
                let branches: Vec<String> = match git::read_git_status(&location).await {
                    Ok(status) => status
                        .branches
                        .items
                        .into_iter()
                        .map(|branch| branch.name)
                        .collect(),
                    Err(_) => Vec::new(),
                };

                github::GithubReader::new(login.clone())
                    .read(&location, &branches, std::time::Duration::ZERO)
                    .await
            }
        };

        println!("{}", serde_json::to_string(&state).unwrap_or_default());
        ExitCode::SUCCESS
    })
}

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let rest = arguments.get(1..).unwrap_or_default();

    if let Some(name) = instance::current().filter(|name| !instance::is_valid(name)) {
        return report_failure(&format!(
            "{} is \"{name}\", but an instance name can only use lowercase letters, digits and single hyphens, such as dev.",
            instance::VARIABLE
        ));
    }

    match arguments.first().map(String::as_str) {
        Some("pair") => pair(rest),
        Some("run") => run(),
        Some("status") => status(),
        Some("service") => service_command(rest),
        Some("allow") => set_tier(rest, true),
        Some("deny") => set_tier(rest, false),
        Some("update") => update_command(rest),
        Some("__scan") => scan(rest),
        Some("__inspect") => inspect(rest),
        Some("__t3code") => t3code(rest),
        Some("__github") => github(rest),
        Some("-v" | "--version") => {
            println!("{}", machine::AGENT_VERSION);
            ExitCode::SUCCESS
        }
        Some("-h" | "--help") | None => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Some(other) => usage_error(&format!("Unknown command \"{other}\".")),
    }
}
