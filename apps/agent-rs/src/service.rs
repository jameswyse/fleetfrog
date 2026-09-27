//! Installing the agent as a per-user background service: a systemd user unit on Linux and a
//! launchd agent on macOS. Both use the TypeScript agent's names, so installing either agent
//! replaces the other's service and reuses its pairing.

use crate::paths;
use crate::process::run_tool;

pub enum ServiceError {
    CommandFailed(String),
    FileFailed { path: String, message: String },
}

const SYSTEMD_UNIT_NAME: &str = "fleetfrog.service";
const LAUNCHD_LABEL: &str = "net.fleetfrog.agent";

/// The command that starts this agent: this binary, with symbolic links resolved.
fn agent_command() -> Result<Vec<String>, ServiceError> {
    let executable = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(|error| {
            ServiceError::CommandFailed(format!(
                "Cannot tell where the agent is installed: {error}"
            ))
        })?;

    Ok(vec![
        executable.to_string_lossy().into_owned(),
        "run".into(),
    ])
}

fn systemd_unit_path() -> String {
    paths::join(
        &paths::env("XDG_CONFIG_HOME").unwrap_or_else(|| paths::join(&paths::home(), ".config")),
        &format!("systemd/user/{SYSTEMD_UNIT_NAME}"),
    )
}

fn launchd_plist_path() -> String {
    paths::join(
        &paths::home(),
        &format!("Library/LaunchAgents/{LAUNCHD_LABEL}.plist"),
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

fn path_variable() -> String {
    std::env::var("PATH").unwrap_or_default()
}

fn systemd_unit(command: &[String]) -> String {
    let exec_start: Vec<String> = command
        .iter()
        .map(|argument| quote_systemd_argument(argument))
        .collect();

    format!(
        "[Unit]
Description=FleetFrog agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart={}
Environment={}
Restart=on-failure
RestartSec=10
# Stopping with SIGTERM lets running actions finish, after which the agent exits with 130.
SuccessExitStatus=130

[Install]
WantedBy=default.target
",
        exec_start.join(" "),
        quote_systemd_argument(&format!("PATH={}", path_variable()))
    )
}

fn launchd_plist(command: &[String]) -> String {
    let log_path = escape_xml(&paths::join(
        &paths::home(),
        "Library/Logs/fleetfrog-agent.log",
    ));
    let arguments: Vec<String> = command
        .iter()
        .map(|argument| format!("    <string>{}</string>", escape_xml(argument)))
        .collect();

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
{}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>{}</string>
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
        escape_xml(&path_variable())
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
        &["--user", "enable", "--now", SYSTEMD_UNIT_NAME],
    )
    .await?;
    // Picks up a changed unit when the service was already running.
    run("systemctl", &["--user", "restart", SYSTEMD_UNIT_NAME]).await?;

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
        &["--user", "disable", "--now", SYSTEMD_UNIT_NAME],
    )
    .await;
    remove_file(&unit)?;
    run("systemctl", &["--user", "daemon-reload"]).await?;

    Ok(unit)
}
