import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeProject, T3CodeThread } from "@fleetfrog/protocol/domain/t3Code";

const urgency = { Waiting: 0, Working: 1, Idle: 2 } satisfies Record<T3CodeThread["state"], number>;

function reading(machine: Machine) {
  const read = machine.t3Code?.reading;

  return read?._tag === "Read" ? read : null;
}

export function busyThreads(
  machine: Machine,
  paths: ReadonlyArray<string>,
): ReadonlyArray<T3CodeThread> {
  return (reading(machine)?.threads ?? [])
    .filter(({ path, state }) => state !== "Idle" && paths.includes(path))
    .toSorted((left, right) => urgency[left.state] - urgency[right.state]);
}

export function threadsAt(machine: Machine, path: string): ReadonlyArray<T3CodeThread> {
  return (reading(machine)?.threads ?? []).filter(
    (thread) => thread.path === path && !thread.archived,
  );
}

export function projectsAt(
  machine: Machine,
  paths: ReadonlyArray<string>,
): ReadonlyArray<T3CodeProject> {
  return (reading(machine)?.projects ?? []).filter(({ path }) => paths.includes(path));
}

export function worktreeThread(machine: Machine, path: string): T3CodeThread | undefined {
  return reading(machine)?.threads.find((thread) => thread.worktree && thread.path === path);
}

export function cloneFolders(checkout: Checkout): ReadonlyArray<string> {
  const worktrees =
    checkout.status._tag === "Read"
      ? checkout.status.git.worktrees
          .filter(({ state }) => state === "Present")
          .map(({ path }) => path)
      : [];

  return [checkout.path, ...worktrees];
}
