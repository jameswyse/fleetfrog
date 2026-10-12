use std::time::{Duration, Instant};

use crate::audit::{self, AuditEntry};
use crate::config::load_policy;
use crate::output::ActionOutput;
use crate::process::{ProgramFailed, run_program};
use crate::protocol::{T3CodeReading, T3CodeThreadState, Tier};
use crate::t3code::{
    Favicons, RunningServer, database_path, read_t3code, running_server, server_pid,
};

const UPDATER_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const RESTART_TIMEOUT: Duration = Duration::from_secs(30);
const RESTART_POLL: Duration = Duration::from_secs(1);
const FAILURE_LINES: usize = 5;
const FAILURE_OUTPUT_CHARACTERS: usize = 1000;

const UNREADABLE: &str = "FleetFrog can't read all of T3 Code's database here, so it can't tell whether a thread is running. Update T3 Code on the machine itself.";
pub const ALREADY_UPDATING: &str = "T3 Code is already updating.";
pub static UPDATING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const NOT_ALLOWED: &str = "This machine's owner hasn't allowed T3 Code updates from the hub. Run fleetfrog allow t3code on it.";

struct Updater {
    program: String,
    replaced: RunningServer,
}

fn updater(server: Option<RunningServer>) -> Result<Updater, String> {
    let server = server.ok_or("T3 Code's server isn't running.")?;

    if !server.server.service_managed {
        return Err(
            "T3 Code runs in its desktop app on this machine, which updates itself.".into(),
        );
    }

    match server.executable.clone() {
        None => Err("Couldn't find T3 Code's executable.".into()),
        Some(program) => Ok(Updater {
            program,
            replaced: server,
        }),
    }
}

fn idle(reading: &T3CodeReading) -> Result<(), String> {
    let working = match reading {
        T3CodeReading::Read {
            threads,
            unread_records: 0,
            ..
        } => threads
            .iter()
            .filter(|thread| thread.state == T3CodeThreadState::Working)
            .count(),
        _ => return Err(UNREADABLE.into()),
    };

    match working {
        0 => Ok(()),
        1 => Err("T3 Code is running 1 thread. Try again when it finishes.".into()),
        count => Err(format!(
            "T3 Code is running {count} threads. Try again when they finish."
        )),
    }
}

fn failure(ended: ProgramFailed, output: &ActionOutput) -> String {
    let summary = match ended {
        ProgramFailed::CouldNotRun(error) => {
            return format!("Couldn't run T3 Code's updater: {error}");
        }
        ProgramFailed::Exited(how) => format!("T3 Code's updater exited with {how}"),
        ProgramFailed::TimedOut => format!(
            "T3 Code's updater took longer than {} minutes and was stopped",
            UPDATER_TIMEOUT.as_secs() / 60
        ),
    };
    let lines = output.tail();
    let last = lines[lines.len().saturating_sub(FAILURE_LINES)..].join("\n");
    let characters = last.chars().count();
    let shown: String = last
        .chars()
        .skip(characters.saturating_sub(FAILURE_OUTPUT_CHARACTERS))
        .collect();

    if shown.is_empty() {
        format!("{summary}.")
    } else {
        format!("{summary}.\n{shown}")
    }
}

pub async fn update(version: &str) -> Result<RunningServer, String> {
    if !load_policy().is_ok_and(|policy| policy.allows(Tier::T3Code)) {
        return Err(NOT_ALLOWED.into());
    }

    let Updater { program, replaced } = updater(running_server().await)?;

    idle(
        &read_t3code(&database_path(), false, &mut Favicons::new())
            .await
            .status
            .reading,
    )?;

    let output = ActionOutput::new();

    run_program(&program, &["update", "--yes"], &output, UPDATER_TIMEOUT)
        .await
        .map_err(|ended| failure(ended, &output))?;
    audit::write(AuditEntry::T3CodeUpdated {
        previous_version: replaced.server.version.clone(),
        version: version.into(),
    });

    Ok(replaced)
}

pub async fn restarted(replaced: &RunningServer) {
    let deadline = Instant::now() + RESTART_TIMEOUT;

    while Instant::now() < deadline && !server_pid().is_some_and(|pid| pid != replaced.pid) {
        tokio::time::sleep(RESTART_POLL).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{T3CodeSchema, T3CodeServer, T3CodeThread};
    use crate::time::Utc;

    fn server(service_managed: bool, executable: Option<&str>) -> Option<RunningServer> {
        Some(RunningServer {
            pid: 64571,
            executable: executable.map(String::from),
            server: T3CodeServer {
                version: Some("0.0.45".into()),
                started_at: Utc::EPOCH,
                port: 3773,
                service_managed,
            },
        })
    }

    fn refusal(server: Option<RunningServer>) -> String {
        updater(server).err().unwrap()
    }

    fn reading(states: &[T3CodeThreadState]) -> T3CodeReading {
        T3CodeReading::Read {
            schema: T3CodeSchema {
                migration: 61,
                name: "migration".into(),
            },
            projects: Vec::new(),
            threads: states
                .iter()
                .enumerate()
                .map(|(index, state)| T3CodeThread {
                    id: index.to_string(),
                    project_id: "project".into(),
                    title: "Thread".into(),
                    path: "/p".into(),
                    worktree: false,
                    state: *state,
                    archived: false,
                    updated_at: Utc::EPOCH,
                })
                .collect(),
            thread_count: states.len() as u64,
            unread_records: 0,
        }
    }

    #[test]
    fn updates_only_a_running_server_that_a_service_runs() {
        assert_eq!(refusal(None), "T3 Code's server isn't running.");
        assert_eq!(
            refusal(server(
                false,
                Some("/Applications/T3 Code.app/Contents/MacOS/T3 Code")
            )),
            "T3 Code runs in its desktop app on this machine, which updates itself."
        );
        assert_eq!(
            refusal(server(true, None)),
            "Couldn't find T3 Code's executable."
        );

        let found = updater(server(
            true,
            Some("/home/me/.t3/runtime/versions/0.0.45/t3"),
        ))
        .ok()
        .unwrap();

        assert_eq!(found.program, "/home/me/.t3/runtime/versions/0.0.45/t3");
        assert_eq!(found.replaced.pid, 64571);
    }

    #[test]
    fn waits_for_working_threads_to_finish() {
        use T3CodeThreadState::{Idle, Waiting, Working};

        assert_eq!(idle(&reading(&[Idle, Waiting])), Ok(()));
        assert_eq!(idle(&T3CodeReading::NotFound), Err(UNREADABLE.into()));
        assert_eq!(
            idle(&T3CodeReading::Unreadable {
                message: "T3 Code's database has no projection_projects.title.".into(),
                schema: None,
            }),
            Err("FleetFrog can't read all of T3 Code's database here, so it can't tell whether a thread is running. Update T3 Code on the machine itself.".into())
        );

        let mut skipped = reading(&[Idle]);

        if let T3CodeReading::Read { unread_records, .. } = &mut skipped {
            *unread_records = 1;
        }

        assert_eq!(idle(&skipped), Err(UNREADABLE.into()));
        assert_eq!(
            idle(&reading(&[Idle, Working])),
            Err("T3 Code is running 1 thread. Try again when it finishes.".into())
        );
        assert_eq!(
            idle(&reading(&[Working, Working, Working, Waiting])),
            Err("T3 Code is running 3 threads. Try again when they finish.".into())
        );
    }

    #[test]
    fn ends_a_failure_with_the_updaters_last_lines() {
        let output = ActionOutput::new();

        output.write("one\n\ntwo\nthree\nfour\nfive\nsix\n");

        assert_eq!(
            failure(ProgramFailed::Exited("code 1".into()), &output),
            "T3 Code's updater exited with code 1.\ntwo\nthree\nfour\nfive\nsix"
        );
        assert_eq!(
            failure(ProgramFailed::TimedOut, &ActionOutput::new()),
            "T3 Code's updater took longer than 10 minutes and was stopped."
        );

        let long = ActionOutput::new();

        long.write(&format!("{}\n", "x".repeat(3000)));

        let message = failure(ProgramFailed::Exited("code 1".into()), &long);

        assert!(message.ends_with(&"x".repeat(FAILURE_OUTPUT_CHARACTERS)));
        assert!(message.len() < FAILURE_OUTPUT_CHARACTERS + 50);
    }
}
