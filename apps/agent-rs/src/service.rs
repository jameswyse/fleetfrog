//! Installing the agent as a per-user background service: a systemd user unit on Linux and a
//! launchd agent on macOS. Both use the TypeScript agent's names, so installing either agent
//! replaces the other's service and reuses its pairing. A named instance gets its own service.

use std::os::fd::AsFd;
use std::os::unix::fs::MetadataExt;
use std::path::PathBuf;

use crate::instance;
use crate::paths;
use crate::process::run_tool;

pub enum ServiceError {
    CommandFailed(String),
    FileFailed { path: String, message: String },
}

fn systemd_unit_name() -> String {
    format!("{}.service", instance::named("fleetfrog"))
}

fn launchd_label() -> String {
    instance::named("net.fleetfrog.agent")
}

/// Where this agent's binary is, with symbolic links resolved, as a service starts it.
pub fn agent_executable() -> Result<PathBuf, String> {
    std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(|error| format!("Cannot tell where the agent is installed: {error}"))
}

/// The command that starts this agent: this binary, with symbolic links resolved.
fn agent_command() -> Result<Vec<String>, ServiceError> {
    let executable = agent_executable().map_err(ServiceError::CommandFailed)?;

    Ok(vec![
        executable.to_string_lossy().into_owned(),
        "run".into(),
    ])
}

fn systemd_unit_path() -> String {
    paths::join(
        &paths::env("XDG_CONFIG_HOME").unwrap_or_else(|| paths::join(&paths::home(), ".config")),
        &format!("systemd/user/{}", systemd_unit_name()),
    )
}

fn launchd_plist_path() -> String {
    paths::join(
        &paths::home(),
        &format!("Library/LaunchAgents/{}.plist", launchd_label()),
    )
}

fn quote_systemd_argument(argument: &str) -> String {
    format!(
        "\"{}\"",
        argument.replace('\\', "\\\\").replace('"', "\\\"")
    )
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The variables the service starts the agent with: the `PATH` it was installed from, so it finds
/// the same Git, and the instance's name, so it reads that instance's files.
fn service_environment() -> Vec<(&'static str, String)> {
    let mut environment = vec![("PATH", std::env::var("PATH").unwrap_or_default())];

    if let Some(name) = instance::current() {
        environment.push((instance::VARIABLE, name));
    }

    environment
}

fn systemd_unit(command: &[String]) -> String {
    let exec_start: Vec<String> = command
        .iter()
        .map(|argument| quote_systemd_argument(argument))
        .collect();
    let environment: Vec<String> = service_environment()
        .iter()
        .map(|(name, value)| {
            format!(
                "Environment={}",
                quote_systemd_argument(&format!("{name}={value}"))
            )
        })
        .collect();
    let description = match instance::current() {
        Some(name) => format!("FleetFrog agent ({name})"),
        None => "FleetFrog agent".to_string(),
    };

    format!(
        "[Unit]
Description={description}
After=network-online.target
Wants=network-online.target

[Service]
ExecStart={}
{}
Restart=on-failure
RestartSec=10
# Stopping with SIGTERM lets running actions finish, after which the agent exits with 130.
SuccessExitStatus=130

[Install]
WantedBy=default.target
",
        exec_start.join(" "),
        environment.join("\n")
    )
}

/// Where launchd writes the agent's output on macOS. On Linux the journal keeps it.
fn launchd_log_path() -> String {
    paths::join(
        &paths::home(),
        &format!("Library/Logs/{}.log", instance::named("fleetfrog-agent")),
    )
}

/// At this size the launchd log moves to `<log>.1`, replacing the previous one.
const ROTATE_LOG_AT_BYTES: u64 = 1024 * 1024;

/// Rotates the launchd log once it is too big, when this process's output goes there. launchd has
/// no rotation of its own and opens the log once, in append mode, so the agent keeps a copy and
/// empties the file in place, and later lines start again at its beginning.
pub fn rotate_log() {
    if !cfg!(target_os = "macos") {
        return;
    }

    let path = launchd_log_path();
    let Ok(output) = std::io::stderr().as_fd().try_clone_to_owned() else {
        return;
    };
    let output = std::fs::File::from(output);
    let (Ok(open), Ok(stored)) = (output.metadata(), std::fs::metadata(&path)) else {
        return;
    };

    if open.dev() != stored.dev()
        || open.ino() != stored.ino()
        || stored.len() < ROTATE_LOG_AT_BYTES
    {
        return;
    }

    // Losing a rotation only leaves the log longer, which the next line retries.
    if std::fs::copy(&path, format!("{path}.1")).is_ok() {
        let _ = output.set_len(0);
    }
}

fn launchd_plist(command: &[String]) -> String {
    let log_path = escape_xml(&launchd_log_path());
    let label = launchd_label();
    let arguments: Vec<String> = command
        .iter()
        .map(|argument| format!("    <string>{}</string>", escape_xml(argument)))
        .collect();
    let environment: Vec<String> = service_environment()
        .iter()
        .map(|(name, value)| {
            format!(
                "    <key>{name}</key>\n    <string>{}</string>",
                escape_xml(value)
            )
        })
        .collect();

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
{}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
{}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>{log_path}</string>
  <key>StandardErrorPath</key>
  <string>{log_path}</string>
</dict>
</plist>
"#,
        arguments.join("\n"),
        environment.join("\n")
    )
}

fn write_file(path: &str, contents: &str) -> Result<(), ServiceError> {
    std::fs::create_dir_all(paths::dirname(path))
        .and_then(|()| std::fs::write(path, contents))
        .map_err(|error| ServiceError::FileFailed {
            path: path.to_string(),
            message: format!("Error: {error}"),
        })
}

fn remove_file(path: &str) -> Result<(), ServiceError> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            Err(ServiceError::FileFailed {
                path: path.to_string(),
                message: format!("Error: {error}"),
            })
        }
        _ => Ok(()),
    }
}

async fn run(tool: &str, args: &[&str]) -> Result<String, ServiceError> {
    run_tool(tool, &paths::home(), args)
        .await
        .map_err(|error| ServiceError::CommandFailed(error.message))
}

fn launchd_domain() -> String {
    // SAFETY: `getuid` has no preconditions.
    format!("gui/{}", unsafe { libc::getuid() })
}

/// Whether this instance's service is installed, whichever binary it starts.
pub fn is_installed() -> bool {
    let definition = if cfg!(target_os = "macos") {
        launchd_plist_path()
    } else {
        systemd_unit_path()
    };

    std::path::Path::new(&definition).exists()
}

/// Installs and starts the agent as a per-user background service. Returns where it was written.
pub async fn install() -> Result<String, ServiceError> {
    let command = agent_command()?;

    if cfg!(target_os = "macos") {
        let plist = launchd_plist_path();

        write_file(&plist, &launchd_plist(&command))?;
        // Replaces an already loaded copy; failing here only means none was loaded.
        let _ = run("launchctl", &["bootout", &launchd_domain(), &plist]).await;
        run("launchctl", &["bootstrap", &launchd_domain(), &plist]).await?;

        return Ok(plist);
    }

    let unit = systemd_unit_path();

    write_file(&unit, &systemd_unit(&command))?;
    run("systemctl", &["--user", "daemon-reload"]).await?;
    run(
        "systemctl",
        &["--user", "enable", "--now", &systemd_unit_name()],
    )
    .await?;
    // Picks up a changed unit when the service was already running.
    run("systemctl", &["--user", "restart", &systemd_unit_name()]).await?;

    Ok(unit)
}

pub async fn uninstall() -> Result<String, ServiceError> {
    if cfg!(target_os = "macos") {
        let plist = launchd_plist_path();

        let _ = run("launchctl", &["bootout", &launchd_domain(), &plist]).await;
        remove_file(&plist)?;

        return Ok(plist);
    }

    let unit = systemd_unit_path();

    let _ = run(
        "systemctl",
        &["--user", "disable", "--now", &systemd_unit_name()],
    )
    .await;
    remove_file(&unit)?;
    run("systemctl", &["--user", "daemon-reload"]).await?;

    Ok(unit)
}
