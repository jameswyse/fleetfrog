import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeProject, T3CodeThread } from "@fleetfrog/protocol/domain/t3Code";

/** A thread waiting on its owner comes before one that's working. */
const urgency = { Waiting: 0, Working: 1, Idle: 2 } satisfies Record<T3CodeThread["state"], number>;

function reading(machine: Machine) {
  const read = machine.t3Code?.reading;

  return read?._tag === "Read" ? read : null;
}

/** Threads part-way through a turn in any of the folders, most urgent first. */
export function busyThreads(
  machine: Machine,
  paths: ReadonlyArray<string>,
): ReadonlyArray<T3CodeThread> {
  return (reading(machine)?.threads ?? [])
    .filter(({ path, state }) => state !== "Idle" && paths.includes(path))
    .toSorted((left, right) => urgency[left.state] - urgency[right.state]);
}

/** Threads working in the folder, newest first, including those that have finished. */
export function threadsAt(machine: Machine, path: string): ReadonlyArray<T3CodeThread> {
  return (reading(machine)?.threads ?? []).filter(
    (thread) => thread.path === path && !thread.archived,
  );
}

/** T3 Code's projects whose folder is one of these. */
export function projectsAt(
  machine: Machine,
  paths: ReadonlyArray<string>,
): ReadonlyArray<T3CodeProject> {
  return (reading(machine)?.projects ?? []).filter(({ path }) => paths.includes(path));
}

/** The thread T3 Code made this worktree for, archived or not. */
export function worktreeThread(machine: Machine, path: string): T3CodeThread | undefined {
  return reading(machine)?.threads.find((thread) => thread.worktree && thread.path === path);
}

/** A main checkout's folder and those of its linked worktrees, which move and go together. */
export function cloneFolders(checkout: Checkout): ReadonlyArray<string> {
  const worktrees =
    checkout.status._tag === "Read"
      ? checkout.status.git.worktrees
          .filter(({ state }) => state === "Present")
          .map(({ path }) => path)
      : [];

  return [checkout.path, ...worktrees];
}
