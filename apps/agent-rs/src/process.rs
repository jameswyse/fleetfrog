//! Running Git and the other tools the agent reads from.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::watch;

use crate::output::{ActionOutput, redact_credentials};

/// Settings every Git command runs with, so a repository's own configuration can't run programs:
/// no file system monitor and no hooks. Actions add `core.askPass=` for the remotes they reach.
const GIT_CONFIG_ARGS: [&str; 4] = [
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
];

/// The transports Git may use, so a remote helper such as `ext::` never runs. Clones allow fewer.
const GIT_PROTOCOLS: &str = "file:git:http:https:ssh";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandFailed {
    pub message: String,
}

impl std::fmt::Display for CommandFailed {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

/// How a Git action ended short of success.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitError {
    /// Git ran and failed. The message is usually Git's own.
    Failed(String),
    /// Cancelling or disconnecting stopped it.
    Interrupted,
}

impl From<CommandFailed> for GitError {
    fn from(error: CommandFailed) -> Self {
        GitError::Failed(error.message)
    }
}

/// A signal that stops whatever waits on it: a cancelled action, or a session that is ending.
#[derive(Clone)]
pub struct Cancel {
    own: Arc<watch::Sender<bool>>,
    /// Signals that cancel this one too, such as the session an action runs in.
    ancestors: Vec<Arc<watch::Sender<bool>>>,
}

impl Cancel {
    pub fn new() -> Cancel {
        Cancel {
            own: Arc::new(watch::channel(false).0),
            ancestors: Vec::new(),
        }
    }

    /// A signal cancelled by its own `cancel` or by this one's.
    pub fn child(&self) -> Cancel {
        let mut ancestors = self.ancestors.clone();

        ancestors.push(self.own.clone());

        Cancel {
            own: Arc::new(watch::channel(false).0),
            ancestors,
        }
    }

    pub fn cancel(&self) {
        self.own.send_replace(true);
    }

    pub fn is_cancelled(&self) -> bool {
        std::iter::once(&self.own)
            .chain(&self.ancestors)
            .any(|signal| *signal.borrow())
    }

    /// Completes once cancelled, and never for a signal nobody cancels.
    pub async fn cancelled(&self) {
        let waits = std::iter::once(&self.own)
            .chain(&self.ancestors)
            .map(|signal| {
                let mut receiver = signal.subscribe();

                Box::pin(async move {
                    let _ = receiver.wait_for(|cancelled| *cancelled).await;
                })
            });

        futures_util::future::select_all(waits).await;
    }
}

/// Git status reads must not take the index lock and race the developer's own Git commands. The
/// same environment suits the other tools: no prompts and untranslated output.
fn tool_command(tool: &str, cwd: &str) -> Command {
    let mut command = Command::new(tool);

    command
        .current_dir(cwd)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ALLOW_PROTOCOL", GIT_PROTOCOLS)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .kill_on_drop(true);

    if tool == "git" {
        command.args(GIT_CONFIG_ARGS);
    }

    command
}

fn spawn_error(tool: &str, error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => format!("spawn {tool} ENOENT"),
        _ => format!("spawn {tool}: {error}"),
    }
}

const TOOL_TIMEOUT: Duration = Duration::from_secs(60);

/// Runs a tool and returns its standard output, failing with its standard error.
pub async fn run_tool(tool: &str, cwd: &str, args: &[&str]) -> Result<String, CommandFailed> {
    let command_line = || {
        std::iter::once(tool)
            .chain(args.iter().copied())
            .collect::<Vec<_>>()
            .join(" ")
    };
    let mut command = tool_command(tool, cwd);

    command.args(args);

    let output = match tokio::time::timeout(TOOL_TIMEOUT, command.output()).await {
        Err(_) => {
            return Err(CommandFailed {
                message: format!("Command failed: {}", command_line()),
            });
        }
        Ok(Err(error)) => {
            return Err(CommandFailed {
                message: spawn_error(tool, &error),
            });
        }
        Ok(Ok(output)) => output,
    };

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stderr = stderr.trim();

    Err(CommandFailed {
        message: if stderr.is_empty() {
            format!("Command failed: {}", command_line())
        } else {
            redact_credentials(stderr)
        },
    })
}

pub async fn run_git(cwd: &str, args: &[&str]) -> Result<String, CommandFailed> {
    run_tool("git", cwd, args).await
}

/// Git actions that take longer than this are stopped. A clone of a large repository fits.
const ACTION_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const ERROR_LINES: usize = 5;
const ERROR_TAIL_BYTES: usize = 4096;

pub struct GitAction<'a> {
    pub cwd: &'a str,
    pub args: Vec<String>,
    /// Receives Git's output as it arrives, or nothing for an action nobody watches.
    pub output: Option<&'a ActionOutput>,
    /// Extra variables, such as `GIT_ALLOW_PROTOCOL` for clones.
    pub environment: &'a [(&'a str, &'a str)],
    /// Written to Git's standard input, such as commands for `update-ref --stdin`.
    pub input: Option<String>,
    pub timeout: Duration,
}

impl<'a> GitAction<'a> {
    pub fn new(cwd: &'a str, args: &[&str], output: &'a ActionOutput) -> GitAction<'a> {
        GitAction {
            output: Some(output),
            ..GitAction::quiet(cwd, args)
        }
    }

    pub fn quiet(cwd: &'a str, args: &[&str]) -> GitAction<'a> {
        GitAction {
            cwd,
            args: args.iter().map(|arg| arg.to_string()).collect(),
            output: None,
            environment: &[],
            input: None,
            timeout: ACTION_TIMEOUT,
        }
    }
}

/// Reads a pipe, passing its text on as it arrives and keeping the last bytes of it when asked.
async fn pump(
    mut pipe: impl AsyncRead + Unpin,
    output: Option<&ActionOutput>,
    keep_tail: bool,
) -> String {
    let mut buffer = [0u8; 8192];
    let mut pending: Vec<u8> = Vec::new();
    let mut tail = String::new();

    loop {
        let read = match pipe.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };

        pending.extend_from_slice(&buffer[..read]);

        // A character split across reads waits for its remaining bytes.
        let complete = match std::str::from_utf8(&pending) {
            Ok(_) => pending.len(),
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            Err(_) => pending.len(),
        };
        let text = String::from_utf8_lossy(&pending[..complete]).into_owned();

        pending.drain(..complete);

        if let Some(output) = output {
            output.write(&text);
        }

        if keep_tail {
            tail.push_str(&text);

            if tail.len() > ERROR_TAIL_BYTES {
                let mut cut = tail.len() - ERROR_TAIL_BYTES;

                while !tail.is_char_boundary(cut) {
                    cut += 1;
                }

                tail.drain(..cut);
            }
        }
    }

    tail
}

fn signal_name(signal: i32) -> String {
    let name = match signal {
        libc::SIGHUP => "SIGHUP",
        libc::SIGINT => "SIGINT",
        libc::SIGKILL => "SIGKILL",
        libc::SIGPIPE => "SIGPIPE",
        libc::SIGTERM => "SIGTERM",
        libc::SIGSEGV => "SIGSEGV",
        libc::SIGABRT => "SIGABRT",
        _ => return format!("signal {signal}"),
    };

    name.to_string()
}

/// Runs Git for an action. Git runs in its own session with no terminal, so SSH fails instead of
/// prompting, and with hooks disabled, so no repository code runs. Cancelling stops Git and
/// anything it started, and waits for them to exit so their locks are gone.
pub async fn run_git_action(action: GitAction<'_>, cancel: &Cancel) -> Result<(), GitError> {
    use std::os::unix::process::ExitStatusExt;

    if cancel.is_cancelled() {
        return Err(GitError::Interrupted);
    }

    let mut args: Vec<String> = ["-c", "core.askPass="].map(String::from).to_vec();

    args.extend(action.args);

    let mut command = tool_command("git", action.cwd);

    // Without an askpass program, SSH can't ask for a passphrase or a new host key, and Git
    // Credential Manager doesn't open a window. Helpers that answer silently still work.
    command
        .args(&args)
        .env_remove("GIT_ASKPASS")
        .env_remove("SSH_ASKPASS")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .env("GCM_INTERACTIVE", "never")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (name, value) in action.environment {
        command.env(name, value);
    }

    // SAFETY: `setsid` is async-signal-safe and only detaches the child from the terminal.
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }

    let mut child = command
        .spawn()
        .map_err(|error| GitError::Failed(spawn_error("git", &error)))?;
    let pid = child.id().map(|pid| pid as i32);
    let mut stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let input = action.input.unwrap_or_default();
    let output = action.output;
    let running = async {
        // Git sees the input, or else an immediate end of input, never a terminal. It is written
        // while the output is read, so neither side waits on a full pipe.
        let writing = async {
            if let Some(mut pipe) = stdin.take() {
                let _ = pipe.write_all(input.as_bytes()).await;
            }
        };
        let reading = async {
            match stdout {
                Some(pipe) => pump(pipe, output, false).await,
                None => String::new(),
            }
        };
        let errors = async {
            match stderr {
                Some(pipe) => pump(pipe, output, true).await,
                None => String::new(),
            }
        };
        let (_, _, tail) = tokio::join!(writing, reading, errors);

        (child.wait().await, tail)
    };

    enum Ended {
        Exited(std::io::Result<std::process::ExitStatus>, String),
        Cancelled,
        TimedOut,
    }

    let ended = tokio::select! {
        biased;
        _ = cancel.cancelled() => Ended::Cancelled,
        (status, tail) = running => Ended::Exited(status, tail),
        _ = tokio::time::sleep(action.timeout) => Ended::TimedOut,
    };

    let (status, tail) = match ended {
        Ended::Exited(status, tail) => (status, tail),
        stopped => {
            if let Some(pid) = pid {
                // SAFETY: signals the process group Git leads, which includes SSH.
                unsafe {
                    libc::kill(-pid, libc::SIGTERM);
                }
            }

            let _ = child.wait().await;

            return Err(match stopped {
                Ended::Cancelled => GitError::Interrupted,
                _ => GitError::Failed(format!(
                    "Git took longer than {}m and was stopped.",
                    action.timeout.as_secs() / 60
                )),
            });
        }
    };

    let status = status.map_err(|error| GitError::Failed(error.to_string()))?;

    if status.success() {
        return Ok(());
    }

    let lines: Vec<&str> = tail
        .split(['\r', '\n'])
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let last = lines[lines.len().saturating_sub(ERROR_LINES)..].join("\n");

    Err(GitError::Failed(if !last.is_empty() {
        redact_credentials(&last)
    } else if let Some(code) = status.code() {
        format!("git exited with code {code}")
    } else {
        format!(
            "git exited with signal {}",
            signal_name(status.signal().unwrap_or(0))
        )
    }))
}

/// Paths per `du` call, well inside every platform's argument limit.
const DU_BATCH: usize = 200;

/// What each path takes up on disk, in bytes, as `du` counts it, so hard links and sparse files
/// count once. Paths are relative to `cwd`, and a path that can't be measured counts as zero.
pub async fn disk_usage(cwd: &str, paths: &[String]) -> Vec<u64> {
    let mut sizes = std::collections::HashMap::new();

    for batch in paths.chunks(DU_BATCH) {
        let mut command = tool_command("du", cwd);

        command.arg("-sk").arg("--").args(batch);

        // `du` still prints what it could measure when some path vanished, so its exit code is
        // ignored.
        if let Ok(Ok(output)) =
            tokio::time::timeout(Duration::from_secs(120), command.output()).await
        {
            for line in String::from_utf8_lossy(&output.stdout).split('\n') {
                if let Some((size, path)) = line.split_once('\t')
                    && let Ok(kilobytes) = size.trim().parse::<u64>()
                {
                    sizes.insert(path.to_string(), kilobytes * 1024);
                }
            }
        }
    }

    paths
        .iter()
        .map(|path| sizes.get(path).copied().unwrap_or(0))
        .collect()
}
