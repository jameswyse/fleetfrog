import { DateTime } from "effect";

import {
  ActionOutcome,
  ActionRequest,
  ActionResult,
  SkipReason,
} from "@fleetfrog/protocol/domain/action";
import { Placement } from "@fleetfrog/protocol/domain/checkout";
import { FolderOutcome } from "@fleetfrog/protocol/domain/fleet";
import { InspectionResult, RemoteCheck, TrashId } from "@fleetfrog/protocol/domain/trash";

import {
  branchTip,
  defaultTip,
  digest,
  emptyRepository,
  localCommitsOf,
  treesOf,
  shortSha,
  upstreamOf,
  uuidFrom,
} from "./demoWorld.ts";

import type { TrashTarget } from "@fleetfrog/protocol/domain/action";
import type { SizedPath } from "@fleetfrog/protocol/domain/trash";

import type { DemoWorld, SimMachine, SimRemote, SimRepository, SimTree } from "./demoWorld.ts";

export interface PlannedAction {
  readonly millis: number;
  readonly progress: ReadonlyArray<string>;
  readonly outcome: ActionOutcome;
  readonly output: ReadonlyArray<string>;
  readonly apply: () => void;
}

function skip(reason: SkipReason): PlannedAction {
  return {
    millis: 200,
    progress: [],
    outcome: ActionOutcome.cases.Skipped.make({ reason }),
    output: [],
    apply: () => {},
  };
}

function fail(message: string, output: ReadonlyArray<string> = []): PlannedAction {
  return {
    millis: 400,
    progress: [],
    outcome: ActionOutcome.cases.Failed.make({ message }),
    output,
    apply: () => {},
  };
}

function succeed(
  result: ActionResult,
  options: {
    readonly millis: number;
    readonly progress?: ReadonlyArray<string>;
    readonly output?: ReadonlyArray<string>;
    readonly apply: () => void;
  },
): PlannedAction {
  return {
    millis: options.millis,
    progress: options.progress ?? [],
    outcome: ActionOutcome.cases.Succeeded.make({ result }),
    output: options.output ?? options.progress ?? [],
    apply: options.apply,
  };
}

interface Located {
  readonly repository: SimRepository;
  readonly tree: SimTree;
}

function locate(machine: SimMachine, path: string): Located | null {
  for (const repository of machine.repositories) {
    const tree = treesOf(repository).find((candidate) => candidate.path === path);

    if (tree !== undefined) {
      return { repository, tree };
    }
  }

  return null;
}

function missing(path: string): PlannedAction {
  return fail(`There's no repository at ${path}.`);
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function dirname(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function pathTaken(machine: SimMachine, path: string): boolean {
  return machine.repositories.some((repository) =>
    treesOf(repository).some((tree) => tree.path === path),
  );
}

function remoteLabel(remote: SimRemote): string {
  return remote.originUrl ?? "origin";
}

function fetchLines(repository: SimRepository): Array<string> {
  const { remote } = repository;
  const before = remote.history[repository.fetched - 1];
  const after = remote.history.at(-1);
  const branch = remote.spec.defaultBranch;

  return [
    `From ${remoteLabel(remote)}`,
    ...(before === undefined || after === undefined || before === after
      ? []
      : [`   ${shortSha(before.sha)}..${shortSha(after.sha)}  ${branch} -> origin/${branch}`]),
  ];
}

function changeCount(tree: SimTree): number {
  return tree.changed.length + tree.untracked.length;
}

function fingerprintOf(repository: SimRepository): string {
  return digest(
    JSON.stringify({
      trees: treesOf(repository).map((tree) => [tree.path, tree.head, changeCount(tree)]),
      branches: repository.branches.map((branch) => [branch.name, branch.ahead, branch.upstream]),
      stashes: repository.stashes.length,
      unpushed: repository.unpushed.length,
      local: repository.local,
    }),
  );
}

function unpushedBranches(repository: SimRepository) {
  const { defaultBranch } = repository.remote.spec;

  return [
    ...(repository.unpushed.length === 0
      ? []
      : [{ name: defaultBranch, commits: repository.unpushed.length }]),
    ...repository.branches.flatMap((branch) => {
      const commits = localCommitsOf(branch);

      return commits === 0 ? [] : [{ name: branch.name, commits }];
    }),
  ];
}

function hasUniqueWork(repository: SimRepository): boolean {
  return (
    unpushedBranches(repository).length > 0 ||
    repository.stashes.length > 0 ||
    treesOf(repository).some((tree) => changeCount(tree) > 0) ||
    repository.remote.originUrl === null
  );
}

function cachesOf(repository: SimRepository): Array<SizedPath> {
  return [{ path: "node_modules/", sizeBytes: Math.round(repository.sizeBytes * 0.62) }];
}

function ignoredOf(repository: SimRepository): Array<SizedPath> {
  return repository.remote.spec.root === "work" ? [{ path: ".env.local", sizeBytes: 412 }] : [];
}

export function inspect(
  machine: SimMachine,
  request: { readonly path: string; readonly worktree: string | null },
): InspectionResult {
  const found = locate(machine, request.path);

  if (found === null) {
    return InspectionResult.cases.Failed.make({
      message: `There's no repository at ${request.path}.`,
    });
  }

  const { repository } = found;
  const fingerprint = fingerprintOf(repository);

  if (request.worktree !== null) {
    const tree = repository.linked.find(({ path }) => path === request.worktree);

    if (tree === undefined) {
      return InspectionResult.cases.Failed.make({ message: "That worktree no longer exists." });
    }

    const ignored = ignoredOf(repository);

    return InspectionResult.cases.WorktreeInspected.make({
      inspection: {
        fingerprint,
        path: tree.path,
        missing: null,
        branch: tree.head,
        locked: null,
        changedFiles: tree.changed.length,
        untrackedFiles: tree.untracked.length,
        unreachableCommits: 0,
        ignored: { items: ignored, total: ignored.length },
        caches: cachesOf(repository),
      },
    });
  }

  const { main } = repository;
  const ignored = ignoredOf(repository);
  const unpushed = unpushedBranches(repository);

  return InspectionResult.cases.Inspected.make({
    inspection: {
      fingerprint,
      sizeBytes: repository.sizeBytes,
      remote:
        repository.remote.originUrl === null
          ? RemoteCheck.cases.NoRemote.make({})
          : RemoteCheck.cases.Fetched.make({}),
      unpushedBranches: unpushed,
      unpushedCommits: unpushed.reduce((sum, { commits }) => sum + commits, 0),
      unpushedTags: 0,
      operation: main.operation,
      submodules: 0,
      stashes: repository.stashes.length,
      changedFiles: main.changed.length,
      untrackedFiles: main.untracked.length,
      ignored: { items: ignored, total: ignored.length },
      caches: cachesOf(repository),
      linkedWorktrees: repository.linked.length,
    },
  });
}

function remoteForUrl(world: DemoWorld, url: string): SimRemote | null {
  return [...world.remotes.values()].find((remote) => remote.originUrl === url) ?? null;
}

function plannedMoves(repository: SimRepository, folder: string) {
  return treesOf(repository).map((tree) => ({
    tree,
    from: tree.path,
    to: `${folder}/${basename(tree.path)}`,
  }));
}

function linkedMoves(moves: ReturnType<typeof plannedMoves>) {
  return moves.slice(1).map(({ from, to }) => ({ from, to }));
}

function planTrashTarget(
  machine: SimMachine,
  target: TrashTarget,
  mode: "Restore" | "Purge",
): PlannedAction {
  if (target._tag === "Checkout") {
    const entry = machine.trash.find(({ item }) => item.id === target.id);

    if (entry === undefined) {
      return skip(SkipReason.cases.NotInTrash.make({}));
    }

    const remove = () => {
      machine.trash.splice(machine.trash.indexOf(entry), 1);
    };

    if (mode === "Purge") {
      return succeed(ActionResult.cases.Purged.make({}), { millis: 600, apply: remove });
    }

    if (pathTaken(machine, entry.item.originalPath)) {
      return skip(SkipReason.cases.DestinationTaken.make({ path: entry.item.originalPath }));
    }

    return succeed(
      ActionResult.cases.Restored.make({ path: entry.item.originalPath, branch: null }),
      {
        millis: 900,
        apply: () => {
          remove();
          entry.repository.main.path = entry.item.originalPath;
          machine.repositories.push(entry.repository);
        },
      },
    );
  }

  const found = locate(machine, target.path);

  if (found === null) {
    return missing(target.path);
  }

  const { repository } = found;

  if (target._tag === "Branch") {
    const deleted = repository.deletedBranches.find(({ record }) => record.ref === target.ref);

    if (deleted === undefined) {
      return skip(SkipReason.cases.NotInTrash.make({}));
    }

    const remove = () => {
      repository.deletedBranches.splice(repository.deletedBranches.indexOf(deleted), 1);
    };

    if (mode === "Purge") {
      return succeed(ActionResult.cases.Purged.make({}), { millis: 300, apply: remove });
    }

    if (repository.branches.some(({ name }) => name === deleted.branch.name)) {
      return skip(SkipReason.cases.BranchExists.make({ branch: deleted.branch.name }));
    }

    return succeed(ActionResult.cases.Restored.make({ path: null, branch: deleted.branch.name }), {
      millis: 300,
      apply: () => {
        remove();
        repository.branches.push(deleted.branch);
      },
    });
  }

  const dropped = repository.droppedStashes.find(({ record }) => record.ref === target.ref);

  if (dropped === undefined) {
    return skip(SkipReason.cases.NotInTrash.make({}));
  }

  const remove = () => {
    repository.droppedStashes.splice(repository.droppedStashes.indexOf(dropped), 1);
  };

  if (mode === "Purge") {
    return succeed(ActionResult.cases.Purged.make({}), { millis: 300, apply: remove });
  }

  return succeed(ActionResult.cases.Restored.make({ path: null, branch: null }), {
    millis: 300,
    apply: () => {
      remove();
      repository.stashes.unshift(dropped.stash);
    },
  });
}

export function planAction(options: {
  readonly world: DemoWorld;
  readonly machine: SimMachine;
  readonly request: ActionRequest;
  readonly now: DateTime.Utc;
}): PlannedAction {
  const { world, machine, request, now } = options;

  return ActionRequest.match(request, {
    Fetch: ({ path }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { repository } = found;

      if (repository.remote.originUrl === null) {
        return fail("The repository has no remote to fetch from.", [
          "fatal: 'origin' does not appear to be a git repository",
        ]);
      }

      return succeed(ActionResult.cases.Fetched.make({}), {
        millis: 1100,
        progress: fetchLines(repository),
        apply: () => {
          repository.fetched = repository.remote.history.length;
          repository.lastFetchedAt = now;
        },
      });
    },
    Pull: ({ path }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { repository, tree } = found;
      const upstream = upstreamOf(repository, tree.head);

      if (tree.operation !== null) {
        return skip(SkipReason.cases.OperationInProgress.make({ operation: tree.operation }));
      }

      if (upstream === null) {
        return skip(SkipReason.cases.NoUpstream.make({}));
      }

      if (upstream.gone) {
        return skip(SkipReason.cases.UpstreamGone.make({}));
      }

      if (tree.changed.length > 0) {
        return skip(SkipReason.cases.UncommittedChanges.make({ files: tree.changed.length }));
      }

      if (upstream.ahead > 0) {
        return skip(SkipReason.cases.UnpushedCommits.make({ commits: upstream.ahead }));
      }

      const onDefault = tree.head === repository.remote.spec.defaultBranch;
      const branch = repository.branches.find(({ name }) => name === tree.head);

      const commits = onDefault
        ? repository.remote.history.length - repository.local
        : (branch?.behind ?? 0);

      const before = branchTip(repository, tree.head);
      const after = onDefault ? repository.remote.history.at(-1) : before;

      const progress = [
        ...fetchLines(repository),
        ...(commits === 0 || before === null || after === undefined || after === null
          ? ["Already up to date."]
          : [
              `Updating ${shortSha(before.sha)}..${shortSha(after.sha)}`,
              "Fast-forward",
              ` ${commits * 3} files changed, ${commits * 41} insertions(+), ${commits * 17} deletions(-)`,
            ]),
      ];

      return succeed(
        commits === 0
          ? ActionResult.cases.UpToDate.make({})
          : ActionResult.cases.FastForwarded.make({ commits }),
        {
          millis: 1600,
          progress,
          apply: () => {
            repository.fetched = repository.remote.history.length;
            repository.lastFetchedAt = now;

            if (onDefault) {
              repository.local = repository.remote.history.length;
            } else if (branch !== undefined) {
              branch.behind = 0;
            }
          },
        },
      );
    },
    Clone: ({ url, destination }) => {
      const remote = remoteForUrl(world, url);

      if (remote === null) {
        return fail("Demo machines can only clone the demo's repositories.");
      }

      if (pathTaken(machine, destination)) {
        return skip(SkipReason.cases.DestinationTaken.make({ path: destination }));
      }

      const objects = 1200 + (Number.parseInt(digest(url).slice(0, 4), 16) % 40000);

      return succeed(ActionResult.cases.Cloned.make({}), {
        millis: 2600,
        progress: [
          `Cloning into '${destination}'...`,
          `remote: Enumerating objects: ${objects}, done.`,
          `Receiving objects: 100% (${objects}/${objects}), done.`,
          `Resolving deltas: 100% (${Math.round(objects * 0.6)}/${Math.round(objects * 0.6)}), done.`,
        ],
        apply: () => {
          machine.repositories.push(emptyRepository({ remote, path: destination, now }));
        },
      });
    },
    Switch: ({ path, branch, stashChanges, discardChanges }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { repository, tree } = found;

      if (tree.head === branch) {
        return skip(SkipReason.cases.AlreadyOnBranch.make({}));
      }

      if (branchTip(repository, branch) === null) {
        return skip(SkipReason.cases.NoSuchBranch.make({}));
      }

      if (treesOf(repository).some((other) => other !== tree && other.head === branch)) {
        return skip(SkipReason.cases.BranchInUse.make({}));
      }

      if (tree.operation !== null) {
        return skip(SkipReason.cases.OperationInProgress.make({ operation: tree.operation }));
      }

      const files = changeCount(tree);

      if (tree.changed.length > 0 && !stashChanges && !discardChanges) {
        return skip(SkipReason.cases.UncommittedChanges.make({ files: tree.changed.length }));
      }

      const stashedFiles = stashChanges ? files : 0;
      const discardedFiles = discardChanges && !stashChanges ? files : 0;
      const from = tree.head;

      return succeed(
        ActionResult.cases.Switched.make({ branch, stashedFiles, savedCommits: 0, discardedFiles }),
        {
          millis: 700,
          progress: [
            ...(stashedFiles > 0
              ? [
                  `Saved working directory and index state On ${from}: before switching to ${branch}`,
                ]
              : []),
            `Switched to branch '${branch}'`,
          ],
          apply: () => {
            if (stashedFiles > 0) {
              repository.stashes.unshift({
                message: `On ${from}: before switching to ${branch}`,
                sha: digest(tree.path, "stash", String(DateTime.toEpochMillis(now))),
              });
            }

            if (stashedFiles > 0 || discardedFiles > 0) {
              tree.changed = [];
              tree.untracked = [];
            }

            tree.head = branch;
          },
        },
      );
    },
    Stash: ({ path }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { repository, tree } = found;
      const files = changeCount(tree);

      if (files === 0) {
        return skip(SkipReason.cases.NothingToStash.make({}));
      }

      const tip = branchTip(repository, tree.head);
      const message = `WIP on ${tree.head}: ${tip === null ? "" : `${shortSha(tip.sha)} ${tip.subject}`}`;

      return succeed(ActionResult.cases.Stashed.make({ files }), {
        millis: 600,
        progress: [`Saved working directory and index state ${message}`],
        apply: () => {
          repository.stashes.unshift({
            message,
            sha: digest(tree.path, "stash", String(DateTime.toEpochMillis(now))),
          });
          tree.changed = [];
          tree.untracked = [];
        },
      });
    },
    Discard: ({ path }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { tree } = found;
      const files = changeCount(tree);

      if (files === 0) {
        return skip(SkipReason.cases.NoChanges.make({}));
      }

      return succeed(ActionResult.cases.Discarded.make({ files }), {
        millis: 500,
        apply: () => {
          tree.changed = [];
          tree.untracked = [];
          tree.operation = null;
        },
      });
    },
    DeleteBranches: ({ path, branches }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { repository } = found;
      const { defaultBranch } = repository.remote.spec;
      const skipped: Array<{ branch: string; reason: SkipReason }> = [];
      const doomed = new Set<string>();

      for (const { name, sha } of branches) {
        const existing = repository.branches.find((branch) => branch.name === name);

        if (name === defaultBranch) {
          skipped.push({
            branch: name,
            reason: SkipReason.cases.DefaultBranch.make({ branch: name }),
          });
        } else if (treesOf(repository).some((tree) => tree.head === name)) {
          skipped.push({
            branch: name,
            reason: SkipReason.cases.BranchCheckedOut.make({ branch: name }),
          });
        } else if (existing === undefined) {
          skipped.push({ branch: name, reason: SkipReason.cases.NoSuchBranch.make({}) });
        } else if (existing.commits[0]?.sha !== sha) {
          skipped.push({
            branch: name,
            reason: SkipReason.cases.BranchChanged.make({ branch: name }),
          });
        } else {
          doomed.add(name);
        }
      }

      return succeed(ActionResult.cases.BranchesDeleted.make({ branches: doomed.size, skipped }), {
        millis: 500,
        progress: [...doomed].map((name) => `Deleted branch ${name}`),
        apply: () => {
          for (const branch of repository.branches.filter(({ name }) => doomed.has(name))) {
            const tip = branch.commits[0];

            repository.branches.splice(repository.branches.indexOf(branch), 1);
            repository.deletedBranches.unshift({
              record: {
                name: branch.name,
                ref: `refs/fleetfrog/deleted/${DateTime.toEpochMillis(now)}/${branch.name}`,
                sha: tip?.sha ?? "",
                subject: tip?.subject ?? "",
                deletedAt: now,
              },
              branch,
            });
          }
        },
      });
    },
    RemoveWorktree: ({ path, worktree, fingerprint, discardChanges }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { repository } = found;
      const tree = repository.linked.find((candidate) => candidate.path === worktree);

      if (tree === undefined) {
        return skip(SkipReason.cases.NoSuchWorktree.make({}));
      }

      if (fingerprint !== fingerprintOf(repository)) {
        return skip(SkipReason.cases.ChangedSinceInspection.make({}));
      }

      const files = changeCount(tree);

      if (files > 0 && !discardChanges) {
        return skip(SkipReason.cases.UncommittedChanges.make({ files }));
      }

      return succeed(
        ActionResult.cases.WorktreeRemoved.make({
          stashedFiles: 0,
          discardedFiles: files,
          savedCommits: 0,
          deletedIgnored: 1,
        }),
        {
          millis: 900,
          apply: () => {
            repository.linked.splice(repository.linked.indexOf(tree), 1);
          },
        },
      );
    },
    DropStashes: ({ path, stashes }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { repository } = found;
      const shas = new Set(stashes.map(({ sha }) => sha));
      const dropping = repository.stashes.filter(({ sha }) => shas.has(sha));

      return succeed(
        ActionResult.cases.StashesDropped.make({
          stashes: dropping.length,
          missing: stashes.length - dropping.length,
        }),
        {
          millis: 400,
          apply: () => {
            for (const stash of dropping) {
              repository.stashes.splice(repository.stashes.indexOf(stash), 1);
              repository.droppedStashes.unshift({
                record: {
                  ref: `refs/fleetfrog/stashes/${DateTime.toEpochMillis(now)}/${repository.droppedStashes.length}`,
                  sha: stash.sha,
                  message: stash.message,
                  droppedAt: now,
                },
                stash,
              });
            }
          },
        },
      );
    },
    Archive: ({ path }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { repository } = found;
      const folder = machine.archiveFolder;

      if (folder === null) {
        return skip(SkipReason.cases.NoArchiveFolder.make({}));
      }

      if (repository.main !== found.tree) {
        return skip(SkipReason.cases.IsWorktree.make({}));
      }

      const destination = `${folder}/${basename(path)}`;

      if (pathTaken(machine, destination)) {
        return skip(SkipReason.cases.DestinationTaken.make({ path: destination }));
      }

      const moves = plannedMoves(repository, folder);

      return succeed(
        ActionResult.cases.Archived.make({ path: destination, worktrees: linkedMoves(moves) }),
        {
          millis: 800,
          apply: () => {
            for (const { tree, to } of moves) {
              tree.path = to;
            }

            repository.placement = Placement.cases.Archive.make({
              originalPath: path,
              archivedAt: now,
            });
          },
        },
      );
    },
    Unarchive: ({ path }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { repository } = found;

      const destination =
        repository.placement._tag === "Archive" && repository.placement.originalPath !== null
          ? repository.placement.originalPath
          : `${machine.spec.roots.projects}/${basename(path)}`;

      if (pathTaken(machine, destination)) {
        return skip(SkipReason.cases.DestinationTaken.make({ path: destination }));
      }

      const moves = plannedMoves(repository, dirname(destination));

      return succeed(
        ActionResult.cases.Unarchived.make({ path: destination, worktrees: linkedMoves(moves) }),
        {
          millis: 800,
          apply: () => {
            for (const { tree, to } of moves) {
              tree.path = to;
            }

            repository.placement = Placement.cases.Projects.make({});
          },
        },
      );
    },
    Trash: ({ path, fingerprint }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { repository, tree } = found;

      if (repository.main !== tree) {
        return skip(SkipReason.cases.IsWorktree.make({}));
      }

      if (fingerprint !== fingerprintOf(repository)) {
        return skip(SkipReason.cases.ChangedSinceInspection.make({}));
      }

      if (repository.linked.length > 0) {
        return skip(SkipReason.cases.HasWorktrees.make({ count: repository.linked.length }));
      }

      return succeed(ActionResult.cases.Trashed.make({ freedBytes: repository.sizeBytes }), {
        millis: 1200,
        apply: () => {
          machine.repositories.splice(machine.repositories.indexOf(repository), 1);
          machine.trash.unshift({
            item: {
              id: TrashId.make(
                uuidFrom(machine.spec.key, path, String(DateTime.toEpochMillis(now))),
              ),
              originalPath: path,
              identity: repository.remote.identity,
              directoryName: basename(path),
              branch: tree.head,
              lastCommit: branchTip(repository, tree.head) ?? defaultTip(repository),
              trashedAt: now,
              sizeBytes: repository.sizeBytes,
              worktrees: [],
            },
            repository,
          });
        },
      });
    },
    Delete: ({ path, fingerprint, discardUniqueWork }) => {
      const found = locate(machine, path);

      if (found === null) {
        return missing(path);
      }

      const { repository, tree } = found;

      if (repository.main !== tree) {
        return skip(SkipReason.cases.IsWorktree.make({}));
      }

      if (fingerprint !== fingerprintOf(repository)) {
        return skip(SkipReason.cases.ChangedSinceInspection.make({}));
      }

      if (hasUniqueWork(repository) && !discardUniqueWork) {
        return skip(SkipReason.cases.UniqueWork.make({}));
      }

      return succeed(ActionResult.cases.Deleted.make({}), {
        millis: 1000,
        apply: () => {
          machine.repositories.splice(machine.repositories.indexOf(repository), 1);
        },
      });
    },
    Restore: ({ target }) => planTrashTarget(machine, target, "Restore"),
    Purge: ({ target }) => planTrashTarget(machine, target, "Purge"),
  });
}

export function createFolder(machine: SimMachine, path: string): FolderOutcome {
  return pathTaken(machine, path)
    ? FolderOutcome.cases.AlreadyThere.make({})
    : FolderOutcome.cases.Created.make({});
}
