//! Moving a checkout with its linked worktrees, for archiving, unarchiving, trashing and
//! restoring.

use crate::git::{self, CheckoutLocation};
use crate::paths;
use crate::process::{GitAction, GitError, run_git_action};
use crate::protocol::{
    ActionOutcome, MovedFolder, SkipReason, Worktree, WorktreeState, failed, skipped,
};

use super::Context;

/// Why the checkout can't leave its place as a whole, or None when it can: only a main checkout
/// whose Git directory is inside it.
pub fn movable_problem(location: &CheckoutLocation) -> Option<ActionOutcome> {
    if matches!(location.worktree, Worktree::Linked { .. }) {
        return Some(skipped(SkipReason::IsWorktree));
    }

    (location.common_directory != paths::join(&location.path, ".git")).then(|| {
        failed("This checkout keeps its Git directory elsewhere, so it can't move safely.")
    })
}

/// Why the checkout can't go without its linked worktrees, which would be left broken.
pub async fn worktrees_problem(
    location: &CheckoutLocation,
) -> Result<Option<ActionOutcome>, GitError> {
    let count = git::count_linked_worktrees(&location.path, &location.common_directory).await?;

    Ok((count > 0).then(|| skipped(SkipReason::HasWorktrees { count })))
}

/// Whether something is already at the path.
pub fn exists(target: &str) -> bool {
    std::fs::symlink_metadata(target).is_ok()
}

enum MoveResult {
    Moved,
    /// Something is already at the destination, so nothing moved.
    Taken,
    Failed(String),
}

/// Moves a checkout's folder, creating the folders above its new place. The move is a rename, so
/// it happens at once or not at all, and only within one disk.
fn move_folder(moved: &MovedFolder) -> MoveResult {
    if exists(&moved.to) {
        return MoveResult::Taken;
    }

    let result = std::fs::create_dir_all(paths::dirname(&moved.to))
        .and_then(|()| std::fs::rename(&moved.from, &moved.to));

    match result {
        Ok(()) => MoveResult::Moved,
        Err(error) if error.raw_os_error() == Some(libc::EXDEV) => MoveResult::Failed(format!(
            "{} is on a different disk from {}, and FleetFrog only moves checkouts within one disk.",
            moved.to, moved.from
        )),
        Err(error) => MoveResult::Failed(format!(
            "Couldn't move {} to {}: Error: {error}",
            moved.from, moved.to
        )),
    }
}

/// Where a main checkout and its linked worktrees go. Worktrees inside the checkout's folder travel
/// with it, the others move on their own or stay where they are, and all of them are relinked.
pub struct CheckoutMove {
    pub main: MovedFolder,
    /// Worktrees inside the main checkout's folder, and where they end up with it.
    pub nested: Vec<MovedFolder>,
    /// Worktrees elsewhere that move on their own.
    pub separate: Vec<MovedFolder>,
    /// Worktrees that stay where they are, which still need relinking.
    pub staying: Vec<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WhenTaken {
    Refuse,
    Number,
}

/// Whether either path is the other or inside it.
fn overlaps(left: &str, right: &str) -> bool {
    paths::is_within(left, right) || paths::is_within(right, left)
}

/// The first of `target`, `target-2`, `target-3` and so on that nothing is at and that doesn't
/// overlap a place already chosen.
fn free_place(target: &str, chosen: &[String]) -> String {
    (1..)
        .map(|number| {
            if number == 1 {
                target.to_string()
            } else {
                format!("{target}-{number}")
            }
        })
        .find(|candidate| {
            !chosen.iter().any(|other| overlaps(candidate, other)) && !exists(candidate)
        })
        .expect("some numbered place is free")
}

/// Where a folder can go, or the refusal when it can't go where it was meant to.
fn place(target: &str, chosen: &[String], when_taken: WhenTaken) -> Result<String, ActionOutcome> {
    if when_taken == WhenTaken::Number {
        return Ok(free_place(target, chosen));
    }

    if let Some(clash) = chosen.iter().find(|other| overlaps(target, other)) {
        return Err(skipped(SkipReason::DestinationsClash {
            path: clash.clone(),
        }));
    }

    if exists(target) {
        Err(skipped(SkipReason::DestinationTaken {
            path: target.to_string(),
        }))
    } else {
        Ok(target.to_string())
    }
}

/// Plans moving the main checkout at `path` to `destination`. `worktree_destination` says where
/// each linked worktree outside it goes, or None to leave it. With `WhenTaken::Number`, a
/// destination that something is already at, or that overlaps another, gets a number added, as
/// `-2` and so on. Otherwise the plan is refused.
pub async fn plan_checkout_move(
    path: &str,
    common_directory: &str,
    destination: &str,
    mut worktree_destination: impl FnMut(&str) -> Option<String>,
    when_taken: WhenTaken,
) -> Result<Result<CheckoutMove, ActionOutcome>, GitError> {
    // A worktree whose folder is gone has nothing to move, and Git can prune it later.
    let linked: Vec<String> = git::read_linked_worktrees(path, common_directory)
        .await?
        .into_iter()
        .filter(|worktree| worktree.state != WorktreeState::Missing)
        .map(|worktree| worktree.path)
        .collect();
    let mut wanted = Vec::new();
    let mut staying = Vec::new();

    for worktree in linked
        .iter()
        .filter(|worktree| !paths::is_within(worktree, path))
    {
        match worktree_destination(worktree) {
            None => staying.push(worktree.clone()),
            Some(to) => wanted.push(MovedFolder {
                from: worktree.clone(),
                to,
            }),
        }
    }

    let main = match place(destination, &[], when_taken) {
        Ok(main) => main,
        Err(refused) => return Ok(Err(refused)),
    };
    let mut chosen = vec![main.clone()];
    let mut separate = Vec::new();

    for MovedFolder { from, to } in wanted {
        match place(&to, &chosen, when_taken) {
            Ok(placed) => {
                chosen.push(placed.clone());
                separate.push(MovedFolder { from, to: placed });
            }
            Err(refused) => return Ok(Err(refused)),
        }
    }

    let nested = linked
        .iter()
        .filter(|worktree| paths::is_within(worktree, path))
        .map(|worktree| MovedFolder {
            from: worktree.clone(),
            to: paths::join(&main, &paths::relative(path, worktree)),
        })
        .collect();

    Ok(Ok(CheckoutMove {
        main: MovedFolder {
            from: path.to_string(),
            to: main,
        },
        nested,
        separate,
        staying,
    }))
}

/// Moves the main checkout, then each separate worktree, then has Git relink every worktree from
/// the checkout's new place. A worktree that couldn't move is relinked where it is. Returns the
/// outcome when the main checkout couldn't move, or else the worktree moves that happened.
pub async fn perform_checkout_move(
    planned: &CheckoutMove,
    context: &Context<'_>,
) -> Result<Vec<MovedFolder>, ActionOutcome> {
    match move_folder(&planned.main) {
        MoveResult::Moved => {}
        MoveResult::Taken => {
            return Err(skipped(SkipReason::DestinationTaken {
                path: planned.main.to.clone(),
            }));
        }
        MoveResult::Failed(message) => return Err(failed(message)),
    }

    context.output.write(&format!(
        "Moved {} to {}\n",
        planned.main.from, planned.main.to
    ));

    let mut moved = Vec::new();
    let mut stayed = planned.staying.clone();

    for worktree in &planned.separate {
        match move_folder(worktree) {
            MoveResult::Moved => {
                moved.push(worktree.clone());
                context
                    .output
                    .write(&format!("Moved {} to {}\n", worktree.from, worktree.to));
            }
            MoveResult::Taken => {
                stayed.push(worktree.from.clone());
                context.output.write(&format!(
                    "Couldn't move the worktree at {}: something is already at {}\n",
                    worktree.from, worktree.to
                ));
            }
            MoveResult::Failed(message) => {
                stayed.push(worktree.from.clone());
                context.output.write(&format!(
                    "Couldn't move the worktree at {}: {message}\n",
                    worktree.from
                ));
            }
        }
    }

    let relinked: Vec<&str> = planned
        .nested
        .iter()
        .map(|worktree| worktree.to.as_str())
        .chain(moved.iter().map(|worktree| worktree.to.as_str()))
        .chain(stayed.iter().map(String::as_str))
        .collect();

    if !relinked.is_empty() {
        let mut args = vec!["worktree", "repair"];

        args.extend(relinked);

        if let Err(GitError::Failed(message)) = run_git_action(
            GitAction::new(&planned.main.to, &args, context.output),
            context.cancel,
        )
        .await
        {
            context
                .output
                .write(&format!("Couldn't relink the worktrees: {message}\n"));
        }
    }

    Ok(moved)
}
