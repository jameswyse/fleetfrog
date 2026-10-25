import { useId, useState } from "react";

import { BotIcon, ChevronRightIcon, FolderGit2Icon, GitForkIcon } from "lucide-react";

import { useMayRun } from "@/rpc/session.ts";
import { Chip } from "@/ui/Chip.tsx";
import { folderName } from "@/ui/folderName.ts";
import { plural } from "@/ui/plural.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";

import { machineBlocker } from "../../actions/actionAvailability.ts";
import { RemoveWorktreeDialog } from "../../cleanup/RemoveWorktreeDialog.tsx";
import { threadsAt } from "../../t3Code/t3CodeLookup.ts";
import { Glyph } from "../CellContent.tsx";
import { ListSection } from "./ListSection.tsx";
import { WorkingTreeDetail } from "./WorkingTreeDetail.tsx";

import type { ReactNode } from "react";

import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeThread } from "@fleetfrog/protocol/domain/t3Code";

import type { CloneOutline, WorkingTree } from "../workingTrees.ts";

const urgency = { Waiting: 0, Working: 1, Idle: 2 } satisfies Record<T3CodeThread["state"], number>;

const stateWords = { Waiting: "Waiting for you", Working: "Working", Idle: null } satisfies Record<
  T3CodeThread["state"],
  string | null
>;

const presenceWords = {
  Present: null,
  Missing: "Folder gone",
  Broken: "Link broken",
} satisfies Record<WorkingTree["presence"], string | null>;

function ThreadLine({ machine, tree }: { readonly machine: Machine; readonly tree: WorkingTree }) {
  const [latest, ...older] = threadsAt(machine, tree.path).toSorted(
    (left, right) =>
      urgency[left.state] - urgency[right.state] ||
      right.updatedAt.epochMilliseconds - left.updatedAt.epochMilliseconds,
  );

  if (latest === undefined) {
    return <span className="truncate">{folderName(tree.path)}</span>;
  }

  const state = stateWords[latest.state];

  return (
    <>
      <BotIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">T3 Code thread: </span>
      {state !== null && <span className="shrink-0 font-medium text-sync">{state} ·</span>}
      <span className="min-w-0 truncate">{latest.title}</span>
      {state === null && (
        <span className="shrink-0">
          · <RelativeTime at={latest.updatedAt} />
        </span>
      )}
      {older.length > 0 && (
        <span
          className="shrink-0 rounded-full bg-canvas px-1.5 tabular-nums"
          title={plural(older.length, "other thread")}
        >
          +{older.length}
        </span>
      )}
    </>
  );
}

function StatusChips({ tree }: { readonly tree: WorkingTree }) {
  const presence = presenceWords[tree.presence];
  const { git, lifecycle } = tree;
  const chips: Array<ReactNode> = [];

  if (presence !== null) {
    chips.push(
      <Chip key="presence" tone="changes">
        {presence}
      </Chip>,
    );
  }

  if (tree.entry?.checkout.status._tag === "Failed") {
    chips.push(
      <Chip key="unreadable" tone="danger">
        Unreadable
      </Chip>,
    );
  }

  if (git !== null) {
    const changes = git.changed.total + git.untracked.total;
    const upstream = git.head._tag === "Branch" ? git.head.upstream : null;

    const conflicts = git.changed.items.some(
      ({ staged, unstaged }) => staged === "U" || unstaged === "U",
    );

    if (conflicts) {
      chips.push(
        <Chip key="conflicts" tone="danger">
          Conflicts
        </Chip>,
      );
    } else if (git.operation !== null) {
      chips.push(
        <Chip key="operation" tone="danger">
          {git.operation}
        </Chip>,
      );
    }

    if (changes > 0) {
      chips.push(
        <Glyph
          key="changes"
          className="text-changes"
          symbol={`●${changes}`}
          meaning={plural(changes, "changed file")}
        />,
      );
    }

    if (upstream !== null && upstream.ahead > 0) {
      chips.push(
        <Glyph
          key="ahead"
          className="text-sync"
          symbol={`↑${upstream.ahead}`}
          meaning={`${plural(upstream.ahead, "commit")} to push`}
        />,
      );
    }

    if (upstream !== null && upstream.behind > 0) {
      chips.push(
        <Glyph
          key="behind"
          className="text-sync"
          symbol={`↓${upstream.behind}`}
          meaning={`${plural(upstream.behind, "commit")} to pull`}
        />,
      );
    }

    if (lifecycle._tag === "Finished") {
      chips.push(
        <Chip key="merged" tone="clean">
          {lifecycle.pullRequest === null ? "Merged" : `Merged #${lifecycle.pullRequest}`}
        </Chip>,
      );
    } else if (upstream?.gone === true) {
      chips.push(
        <Chip key="gone" tone="changes">
          Remote deleted
        </Chip>,
      );
    } else if (git.head._tag === "Branch" && upstream === null) {
      chips.push(
        <Chip key="upstream" tone="neutral">
          No upstream
        </Chip>,
      );
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium tabular-nums">
      {chips}
    </span>
  );
}

function TreeLabel({ tree }: { readonly tree: WorkingTree }) {
  if (tree.entry?.checkout.status._tag === "Failed") {
    return <span className="truncate">{folderName(tree.path)}</span>;
  }

  return <span className="truncate font-mono text-[13px]">{tree.branch ?? "Detached HEAD"}</span>;
}

function TreeRow({
  repository,
  machine,
  clonePath,
  tree,
  isMain,
  selected,
  onChoosePath,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly clonePath: string;
  readonly tree: WorkingTree;
  readonly isMain: boolean;
  readonly selected: boolean;
  readonly onChoosePath: (path: string) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const mayRemove = useMayRun("RemoveWorktree");
  const Icon = isMain ? FolderGit2Icon : GitForkIcon;
  const detailId = useId();

  const content = (
    <>
      <Icon aria-hidden="true" className="mt-0.5 shrink-0 self-start text-ink-muted" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <TreeLabel tree={tree} />
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
          <ThreadLine machine={machine} tree={tree} />
        </span>
      </span>
      <StatusChips tree={tree} />
    </>
  );

  if (tree.entry === null) {
    return (
      <li className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm" title={tree.path}>
        {content}
        {mayRemove && machineBlocker(machine, "RemoveWorktree") === null && (
          <button
            type="button"
            onClick={() => setRemoving(true)}
            aria-label={`Remove the worktree at ${tree.path}`}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-canvas hover:text-danger"
          >
            Remove
          </button>
        )}
        {removing && (
          <RemoveWorktreeDialog
            machine={machine}
            mainPath={clonePath}
            worktree={tree.path}
            discardUnavailable={null}
            onClose={() => setRemoving(false)}
          />
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        aria-expanded={selected}
        aria-controls={selected ? detailId : undefined}
        onClick={() => onChoosePath(tree.path)}
        title={tree.path}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-canvas aria-expanded:bg-accent-soft"
      >
        {content}
      </button>
      {selected && (
        <WorkingTreeDetail
          id={detailId}
          repository={repository}
          machine={machine}
          checkout={tree.entry.checkout}
          lifecycle={tree.lifecycle}
          onShowWorkingTree={onChoosePath}
        />
      )}
    </li>
  );
}

type GroupKind = "Finished" | "RemoteGone";

const groupWords = {
  Finished: { title: "Finished", note: "Merged and clean" },
  RemoteGone: { title: "Remote deleted", note: "No merge found" },
} satisfies Record<GroupKind, { readonly title: string; readonly note: string }>;

export function WorkingTreeOutline({
  repository,
  machine,
  clone,
  title,
  selectedPath,
  onChoosePath,
  onCleanUp,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly clone: CloneOutline;
  readonly title: string | null;
  readonly selectedPath: string;
  readonly onChoosePath: (path: string) => void;
  readonly onCleanUp: (() => void) | null;
}) {
  const [opened, setOpened] = useState<ReadonlySet<GroupKind>>(new Set());
  const active = clone.linked.filter(({ lifecycle }) => lifecycle._tag === "Active");

  const groups = (["Finished", "RemoteGone"] as const).map((kind) => ({
    kind,
    trees: clone.linked.filter(({ lifecycle }) => lifecycle._tag === kind),
  }));

  const row = (tree: WorkingTree, isMain: boolean) => (
    <TreeRow
      key={tree.path}
      repository={repository}
      machine={machine}
      clonePath={clone.path}
      tree={tree}
      isMain={isMain}
      selected={tree.path === selectedPath}
      onChoosePath={onChoosePath}
    />
  );

  const outline = (
    <ul>
      {clone.main !== null && row(clone.main, true)}
      {clone.linked.length > 0 && (
        <li>
          <ul className={clone.main === null ? "" : "ms-4 border-s border-line ps-1.5"}>
            {active.map((tree) => row(tree, false))}
            {groups.map(({ kind, trees }) => {
              if (trees.length === 0) {
                return null;
              }

              const open = opened.has(kind) || trees.some(({ path }) => path === selectedPath);

              return (
                <li key={kind}>
                  <div className="flex items-center gap-2 pe-1">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() =>
                        setOpened((previous) => {
                          const next = new Set(previous);

                          if (open) {
                            next.delete(kind);
                          } else {
                            next.add(kind);
                          }

                          return next;
                        })
                      }
                      className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-start text-sm hover:bg-canvas"
                    >
                      <ChevronRightIcon
                        aria-hidden="true"
                        className={`shrink-0 text-ink-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
                      />
                      <span className="font-medium">{groupWords[kind].title}</span>
                      <span className="rounded-full bg-canvas px-1.5 text-xs font-medium text-ink-muted tabular-nums">
                        {trees.length}
                      </span>
                      <span className="truncate text-xs text-ink-muted">
                        {groupWords[kind].note}
                      </span>
                    </button>
                    {kind === "Finished" && onCleanUp !== null && (
                      <button
                        type="button"
                        onClick={onCleanUp}
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-accent-text hover:bg-canvas"
                      >
                        Clean up…
                      </button>
                    )}
                  </div>
                  {open && <ul>{trees.map((tree) => row(tree, false))}</ul>}
                </li>
              );
            })}
          </ul>
        </li>
      )}
    </ul>
  );

  return title === null ? (
    <div className="-mx-1">{outline}</div>
  ) : (
    <ListSection title={title} count={clone.linked.length + (clone.main === null ? 0 : 1)}>
      <div className="-mx-1">{outline}</div>
    </ListSection>
  );
}
