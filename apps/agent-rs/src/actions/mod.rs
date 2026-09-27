//! The actions the hub can ask this agent to run, and the runner that checks, queues and reports
//! them.

pub mod archive;
pub mod detached;
pub mod git_actions;
pub mod moves;
pub mod runner;
pub mod stashes;
pub mod trash;
pub mod worktree;

use crate::output::ActionOutput;
use crate::process::{Cancel, GitError};
use crate::protocol::{ActionOutcome, failed};

/// What an action writes its output to, and what stops it part-way.
pub struct Context<'a> {
    pub output: &'a ActionOutput,
    /// Cancelled for a cancellable action the owner or a lost connection stops. Actions that move,
    /// delete or rewrite refs get one that is never cancelled, so nothing is left half done.
    pub cancel: &'a Cancel,
}

/// The action was stopped part-way, so it has no outcome of its own.
#[derive(Debug, PartialEq, Eq)]
pub struct Interrupted;

/// An action's outcome, with a Git failure as a failed outcome carrying Git's own message.
pub fn settle(result: Result<ActionOutcome, GitError>) -> Result<ActionOutcome, Interrupted> {
    match result {
        Ok(outcome) => Ok(outcome),
        Err(GitError::Failed(message)) => Ok(failed(message)),
        Err(GitError::Interrupted) => Err(Interrupted),
    }
}
