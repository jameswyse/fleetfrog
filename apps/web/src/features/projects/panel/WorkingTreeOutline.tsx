import { useId, useState } from "react";

import {
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderGit2Icon,
  GitForkIcon,
} from "lucide-react";

import { useMayRun } from "@/rpc/session.ts";
import { Chip } from "@/ui/Chip.tsx";
import { folderName } from "@/ui/folderName.ts";
import { plural } from "@/ui/plural.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";

import { machineBlocker } from "../../actions/actionAvailability.ts";
import { SyncGlyphs } from "../../branches/BranchState.tsx";
import { RemoveWorktreeDialog } from "../../cleanup/RemoveWorktreeDialog.tsx";
import { threadsByUrgency } from "../../t3Code/t3CodeLookup.ts";
import { threadStateWords } from "../../t3Code/T3CodeNotices.tsx";
import { Glyph } from "../CellContent.tsx";
import { workingTreesOf } from "../workingTrees.ts";
import { CountPill, ListCard, ListSection } from "./ListSection.tsx";
import { WorkingTreeDetail } from "./WorkingTreeDetail.tsx";

import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { CloneOutline, WorkingTree } from "../workingTrees.ts";

const presenceWords = {
  Present: null,
  Missing: "Folder gone",
  Broken: "Link broken",
} satisfies Record<WorkingTree["presence"], string | null>;

function ThreadLine({ machine, tree }: { readonly machine: Machine; readonly tree: WorkingTree }) {
  const [latest, ...older] = threadsByUrgency(machine, tree.path);

  if (latest === undefined) {
    return <span className="truncate">{folderName(tree.path)}</span>;
  }

  const state = threadStateWords[latest.state];

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
          className="shrink-0 rounded-full bg-chip px-1.5 tabular-nums"
          title={plural(older.length, "other thread")}
        >
          +{older.length}
        </span>
      )}
    </>
  );
}

function problemChip(problem: NonNullable<WorkingTree["problem"]>): string {
  switch (problem._tag) {
    case "Unreadable":
      return "Unreadable";
    case "Conflicts":
      return "Conflicts";
    case "Operation":
      return `${problem.operation} in progress`;

    default: {
      const _exhaustive: never = problem;

      return _exhaustive;
    }
  }
}

function StatusChips({ tree }: { readonly tree: WorkingTree }) {
  const presence = presenceWords[tree.presence];
  const { git, merge, problem } = tree;
  const upstream = git?.head._tag === "Branch" ? git.head.upstream : null;
  const changes = git === null ? 0 : git.changed.total + git.untracked.total;

  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium tabular-nums">
      {presence !== null && <Chip tone="changes">{presence}</Chip>}
      {problem !== null && <Chip tone="danger">{problemChip(problem)}</Chip>}
      {changes > 0 && (
        <Glyph
          className="text-changes"
          symbol={`●${changes}`}
          meaning={plural(changes, "changed file")}
        />
      )}
      {upstream !== null && <SyncGlyphs ahead={upstream.ahead} behind={upstream.behind} />}
      {merge !== null && (
        <Chip tone="clean">
          {merge._tag === "PullRequest" ? `Merged #${merge.pullRequest.number}` : "Merged"}
        </Chip>
      )}
      {merge === null && upstream?.gone === true && <Chip tone="changes">Remote deleted</Chip>}
      {git?.head._tag === "Branch" && upstream === null && merge === null && (
        <Chip tone="neutral">No upstream</Chip>
      )}
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
  expanded,
  onToggle,
  onChoosePath,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly clonePath: string;
  readonly tree: WorkingTree;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onChoosePath: (path: string) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const mayRemove = useMayRun("RemoveWorktree");
  const Icon = tree.kind === "Main" ? FolderGit2Icon : GitForkIcon;
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
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-fill hover:text-danger"
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
    <li className={expanded ? "overflow-hidden rounded-lg bg-fill" : undefined}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? detailId : undefined}
        onClick={onToggle}
        title={tree.path}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-fill"
      >
        {content}
        <ChevronDownIcon
          aria-hidden="true"
          className={`size-4 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <WorkingTreeDetail
          id={detailId}
          repository={repository}
          machine={machine}
          tree={tree}
          checkout={tree.entry.checkout}
          onShowWorkingTree={onChoosePath}
        />
      )}
    </li>
  );
}

export type GroupKind = "Finished" | "RemoteGone";

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
  expandedPath,
  groupOverrides,
  onTogglePath,
  onToggleGroup,
  onChoosePath,
  onCleanUp,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly clone: CloneOutline;
  readonly title: string | null;
  readonly selectedPath: string;
  readonly expandedPath: string | null;
  readonly groupOverrides: ReadonlyMap<GroupKind, boolean>;
  readonly onTogglePath: (path: string) => void;
  readonly onToggleGroup: (kind: GroupKind, open: boolean) => void;
  readonly onChoosePath: (path: string) => void;
  readonly onCleanUp: (() => void) | null;
}) {
  const active = clone.linked.filter(({ lifecycle }) => lifecycle._tag === "Active");

  const groups = (["Finished", "RemoteGone"] as const).map((kind) => ({
    kind,
    trees: clone.linked.filter(({ lifecycle }) => lifecycle._tag === kind),
  }));

  const row = (tree: WorkingTree) => (
    <TreeRow
      key={tree.path}
      repository={repository}
      machine={machine}
      clonePath={clone.path}
      tree={tree}
      expanded={tree.path === expandedPath}
      onToggle={() => onTogglePath(tree.path)}
      onChoosePath={onChoosePath}
    />
  );

  const outline = (
    <ul>
      {clone.main === null ? (
        <li className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm" title={clone.path}>
          <FolderGit2Icon aria-hidden="true" className="shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1 truncate">{folderName(clone.path)}</span>
          <span className="shrink-0 text-xs text-ink-muted">Clone not scanned</span>
        </li>
      ) : (
        row(clone.main)
      )}
      {clone.linked.length > 0 && (
        <li>
          <ul className="ms-4 border-s border-line ps-1.5">
            {active.map(row)}
            {groups.map(({ kind, trees }) => {
              if (trees.length === 0) {
                return null;
              }

              const open =
                groupOverrides.get(kind) ?? trees.some(({ path }) => path === selectedPath);

              return (
                <li key={kind}>
                  <div className="flex items-center gap-2 pe-1">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => onToggleGroup(kind, !open)}
                      className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-start text-sm hover:bg-fill"
                    >
                      <ChevronRightIcon
                        aria-hidden="true"
                        className={`shrink-0 text-ink-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
                      />
                      <span className="font-medium">{groupWords[kind].title}</span>
                      <CountPill count={trees.length} />
                      <span className="truncate text-xs text-ink-muted">
                        {groupWords[kind].note}
                      </span>
                    </button>
                    {kind === "Finished" && onCleanUp !== null && (
                      <button
                        type="button"
                        onClick={onCleanUp}
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-accent-text hover:bg-fill"
                      >
                        Clean up…
                      </button>
                    )}
                  </div>
                  {open && <ul>{trees.map(row)}</ul>}
                </li>
              );
            })}
          </ul>
        </li>
      )}
    </ul>
  );

  return title === null ? (
    <ListCard>{outline}</ListCard>
  ) : (
    <ListSection title={title} count={workingTreesOf(clone).length}>
      {outline}
    </ListSection>
  );
}
